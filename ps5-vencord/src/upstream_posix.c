/* Backend de pruebas para Linux/macOS: HTTP/1.0 plano (sin TLS).
 * Sirve para probar el proxy contra un servidor simulado en local.
 * En la PS5 se usa upstream_sce.c. */
#include <errno.h>
#include <netdb.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <unistd.h>

#include "upstream.h"

typedef struct posix_priv {
  int    fd;
  char  *pending;   /* bytes del cuerpo ya leidos junto con las cabeceras */
  size_t pending_len;
  size_t pending_off;
} posix_priv_t;

int
up_init(int insecure_tls) {
  (void)insecure_tls;
  return 0;
}

static int
parse_url(const char *url, char *host, size_t hlen, char *port, size_t plen,
          const char **path) {
  const char *p, *slash, *colon;

  if(strncmp(url, "http://", 7)) {
    fprintf(stderr, "[vc] backend host solo admite http:// (%s)\n", url);
    return -1;
  }
  p = url + 7;
  slash = strchr(p, '/');
  if(!slash) slash = p + strlen(p);
  colon = memchr(p, ':', slash - p);
  if(colon) {
    snprintf(host, hlen, "%.*s", (int)(colon - p), p);
    snprintf(port, plen, "%.*s", (int)(slash - colon - 1), colon + 1);
  } else {
    snprintf(host, hlen, "%.*s", (int)(slash - p), p);
    snprintf(port, plen, "80");
  }
  *path = *slash ? slash : "/";
  return 0;
}

static int
send_all(int fd, const void *buf, size_t len) {
  const char *p = buf;
  while(len) {
    ssize_t n = send(fd, p, len, MSG_NOSIGNAL);
    if(n <= 0) {
      if(n < 0 && errno == EINTR) continue;
      return -1;
    }
    p += n;
    len -= n;
  }
  return 0;
}

int
up_request(const char *method, const char *url, const up_header_t *headers,
           const void *body, size_t body_len, up_resp_t *out) {
  char host[256], port[16], line[8192];
  struct addrinfo hints = {0}, *ai = 0;
  const char *path;
  posix_priv_t *p;
  char *buf = 0, *end;
  size_t cap = 0, len = 0;
  int fd = -1;

  memset(out, 0, sizeof(*out));
  out->content_length = -1;

  if(parse_url(url, host, sizeof(host), port, sizeof(port), &path)) {
    return -1;
  }
  hints.ai_family = AF_UNSPEC;
  hints.ai_socktype = SOCK_STREAM;
  if(getaddrinfo(host, port, &hints, &ai) || !ai) {
    return -1;
  }
  fd = socket(ai->ai_family, ai->ai_socktype, ai->ai_protocol);
  if(fd < 0 || connect(fd, ai->ai_addr, ai->ai_addrlen)) {
    freeaddrinfo(ai);
    if(fd >= 0) close(fd);
    return -1;
  }
  freeaddrinfo(ai);

  snprintf(line, sizeof(line), "%s %s HTTP/1.0\r\nHost: %s:%s\r\n"
           "Connection: close\r\nAccept-Encoding: identity\r\n"
           "Content-Length: %zu\r\n", method, path, host, port, body_len);
  if(send_all(fd, line, strlen(line))) goto fail;
  for(int i = 0; headers && headers[i].name; i++) {
    snprintf(line, sizeof(line), "%s: %s\r\n", headers[i].name,
             headers[i].value);
    if(send_all(fd, line, strlen(line))) goto fail;
  }
  if(send_all(fd, "\r\n", 2)) goto fail;
  if(body_len && send_all(fd, body, body_len)) goto fail;

  /* leer hasta el final de las cabeceras */
  for(;;) {
    ssize_t n;
    if(len + 4096 + 1 > cap) {
      cap = cap ? cap * 2 : 16384;
      char *nb = realloc(buf, cap);
      if(!nb) goto fail;
      buf = nb;
    }
    n = recv(fd, buf + len, cap - len - 1, 0);
    if(n <= 0) goto fail;
    len += n;
    buf[len] = 0;
    if((end = strstr(buf, "\r\n\r\n"))) break;
  }

  if(sscanf(buf, "HTTP/%*s %d", &out->status) != 1) goto fail;

  {
    char *hstart = strstr(buf, "\r\n") + 2;
    size_t hlen = end + 2 - hstart;
    out->headers = malloc(hlen + 1);
    if(!out->headers) goto fail;
    memcpy(out->headers, hstart, hlen);
    out->headers[hlen] = 0;
  }

  if(!(p = calloc(1, sizeof(*p)))) goto fail;
  p->fd = fd;
  p->pending = buf;
  p->pending_off = (end + 4) - buf;
  p->pending_len = len;
  out->priv = p;
  return 0;

fail:
  free(buf);
  free(out->headers);
  out->headers = 0;
  if(fd >= 0) close(fd);
  return -1;
}

ssize_t
up_read(up_resp_t *r, void *buf, size_t len) {
  posix_priv_t *p = r->priv;
  ssize_t n;

  if(!p) return 0;
  if(p->pending_off < p->pending_len) {
    size_t avail = p->pending_len - p->pending_off;
    if(avail > len) avail = len;
    memcpy(buf, p->pending + p->pending_off, avail);
    p->pending_off += avail;
    return avail;
  }
  do {
    n = recv(p->fd, buf, len, 0);
  } while(n < 0 && errno == EINTR);
  return n;
}

void
up_close(up_resp_t *r) {
  posix_priv_t *p = r->priv;
  if(p) {
    close(p->fd);
    free(p->pending);
    free(p);
  }
  free(r->headers);
  memset(r, 0, sizeof(*r));
}
