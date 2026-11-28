/* Servidor HTTP local (127.0.0.1) que hace de proxy inverso hacia
 * discord.com, quita las cabeceras que impiden inyectar codigo (CSP, HSTS)
 * e inserta Vencord al principio de cada pagina HTML. */
#include <ctype.h>
#include <errno.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <arpa/inet.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>

#include "config.h"
#include "proxy.h"
#include "upstream.h"
#include "vencord.h"
#include "web.h"

#define MAX_REQ_HEADER   (64 * 1024)
#define MAX_REQ_BODY     (32 * 1024 * 1024)
#define MAX_HTML_BODY    (16 * 1024 * 1024)
#define MAX_HEADERS      128

typedef struct req {
  char  method[16];
  char  target[8192];   /* ruta + query */
  int   http10;
  char *hname[MAX_HEADERS];
  char *hval[MAX_HEADERS];
  int   nheaders;
  char *body;
  size_t body_len;
} req_t;

/* ------------------------------------------------------------------ */
/* utilidades de cadenas                                               */
/* ------------------------------------------------------------------ */

char *
vc_replace_all(const char *src, size_t len, const char *from, const char *to,
               size_t *out_len) {
  size_t flen = strlen(from), tlen = strlen(to), count = 0, o = 0;
  const char *p = src, *end = src + len, *hit;
  char *out;

  while((hit = memmem(p, end - p, from, flen))) {
    count++;
    p = hit + flen;
  }
  if(!(out = malloc(len + count * (tlen > flen ? tlen - flen : 0) + 1))) {
    return 0;
  }
  p = src;
  while((hit = memmem(p, end - p, from, flen))) {
    memcpy(out + o, p, hit - p);
    o += hit - p;
    memcpy(out + o, to, tlen);
    o += tlen;
    p = hit + flen;
  }
  memcpy(out + o, p, end - p);
  o += end - p;
  out[o] = 0;
  *out_len = o;
  return out;
}

static const char *
memcasemem(const char *hay, size_t hlen, const char *needle) {
  size_t nlen = strlen(needle);
  for(size_t i = 0; i + nlen <= hlen; i++) {
    if(!strncasecmp(hay + i, needle, nlen)) return hay + i;
  }
  return 0;
}

char *
vc_inject_head(const char *src, size_t len, const char *snippet,
               size_t *out_len) {
  size_t slen = strlen(snippet), at = 0;
  const char *head, *gt;
  char *out;

  /* "<head>" o "<head ...>", pero no "<header" */
  head = src;
  while((head = memcasemem(head, len - (head - src), "<head"))) {
    char c = head[5];
    if(c == '>' || isspace((unsigned char)c)) break;
    head += 5;
  }
  if(head && (gt = memchr(head, '>', len - (head - src)))) {
    at = gt + 1 - src;
  }
  if(!(out = malloc(len + slen + 1))) return 0;
  memcpy(out, src, at);
  memcpy(out + at, snippet, slen);
  memcpy(out + at + slen, src + at, len - at);
  out[len + slen] = 0;
  *out_len = len + slen;
  return out;
}

/* Set-Cookie de discord.com -> cookie valida para http://127.0.0.1 */
void
vc_rewrite_set_cookie(const char *in, char *out, size_t out_size) {
  char buf[4096];
  char *save = 0, *tok;
  size_t o = 0;
  int first = 1;

  snprintf(buf, sizeof(buf), "%s", in);
  out[0] = 0;
  for(tok = strtok_r(buf, ";", &save); tok; tok = strtok_r(0, ";", &save)) {
    while(*tok == ' ') tok++;
    if(!first) {
      if(!strncasecmp(tok, "domain=", 7) || !strcasecmp(tok, "secure") ||
         !strcasecmp(tok, "partitioned")) {
        continue;
      }
      if(!strncasecmp(tok, "samesite=none", 13)) {
        tok = "SameSite=Lax";
      }
    }
    o += snprintf(out + o, o < out_size ? out_size - o : 0, "%s%s",
                  first ? "" : "; ", tok);
    first = 0;
  }
}

static const char *
req_header(const req_t *r, const char *name) {
  for(int i = 0; i < r->nheaders; i++) {
    if(!strcasecmp(r->hname[i], name)) return r->hval[i];
  }
  return 0;
}

static const char *
reason(int status) {
  switch(status) {
  case 200: return "OK";
  case 201: return "Created";
  case 204: return "No Content";
  case 301: return "Moved Permanently";
  case 302: return "Found";
  case 304: return "Not Modified";
  case 307: return "Temporary Redirect";
  case 308: return "Permanent Redirect";
  case 400: return "Bad Request";
  case 401: return "Unauthorized";
  case 403: return "Forbidden";
  case 404: return "Not Found";
  case 411: return "Length Required";
  case 413: return "Payload Too Large";
  case 429: return "Too Many Requests";
  case 500: return "Internal Server Error";
  case 502: return "Bad Gateway";
  default:  return "Status";
  }
}

static int
url_decode(const char *in, char *out, size_t out_size) {
  size_t o = 0;
  for(; *in && o + 1 < out_size; in++) {
    if(*in == '%' && isxdigit((unsigned char)in[1]) &&
       isxdigit((unsigned char)in[2])) {
      char hex[3] = {in[1], in[2], 0};
      out[o++] = (char)strtol(hex, 0, 16);
      in += 2;
    } else if(*in == '+') {
      out[o++] = ' ';
    } else {
      out[o++] = *in;
    }
  }
  out[o] = 0;
  return 0;
}

/* valor de un parametro de la query (decodificado) */
static int
query_param(const char *target, const char *key, char *out, size_t out_size) {
  const char *q = strchr(target, '?');
  size_t klen = strlen(key);
  if(!q) return -1;
  q++;
  while(*q) {
    const char *amp = strchr(q, '&');
    size_t seglen = amp ? (size_t)(amp - q) : strlen(q);
    if(seglen > klen && !strncmp(q, key, klen) && q[klen] == '=') {
      char tmp[8192];
      snprintf(tmp, sizeof(tmp), "%.*s", (int)(seglen - klen - 1),
               q + klen + 1);
      return url_decode(tmp, out, out_size);
    }
    if(!amp) break;
    q = amp + 1;
  }
  return -1;
}

/* ------------------------------------------------------------------ */
/* E/S con el navegador                                                */
/* ------------------------------------------------------------------ */

static int
send_all(int fd, const void *buf, size_t len) {
  const char *p = buf;
  while(len) {
    ssize_t n = send(fd, p, len, 0);
    if(n <= 0) {
      if(n < 0 && errno == EINTR) continue;
      return -1;
    }
    p += n;
    len -= n;
  }
  return 0;
}

static int
send_chunk(int fd, const void *buf, size_t len) {
  char hdr[32];
  if(!len) return 0;
  snprintf(hdr, sizeof(hdr), "%zx\r\n", len);
  if(send_all(fd, hdr, strlen(hdr))) return -1;
  if(send_all(fd, buf, len)) return -1;
  return send_all(fd, "\r\n", 2);
}

static int
send_simple(int fd, int status, const char *ctype, const char *extra_headers,
            const char *body, size_t len) {
  char hdr[2048];
  snprintf(hdr, sizeof(hdr),
           "HTTP/1.1 %d %s\r\n"
           "Content-Type: %s\r\n"
           "Content-Length: %zu\r\n"
           "Cache-Control: no-cache\r\n"
           "%s"
           "\r\n", status, reason(status), ctype, len,
           extra_headers ? extra_headers : "");
  if(send_all(fd, hdr, strlen(hdr))) return -1;
  return len ? send_all(fd, body, len) : 0;
}

static int
send_text(int fd, int status, const char *msg) {
  return send_simple(fd, status, "text/plain; charset=utf-8", 0, msg,
                     strlen(msg));
}

/* Lee la peticion completa. 0 = ok, 1 = conexion cerrada, -1 = error,
 * -2 = cuerpo chunked (no soportado), -3 = cuerpo demasiado grande.
 * Los navegadores no hacen pipelining en HTTP/1.1, asi que no hay datos
 * de la siguiente peticion detras del cuerpo. */
static int
read_request(int fd, char *buf, req_t *r) {
  size_t len = 0, hdr_total, have, want = 0;
  char *end, *line, *save = 0;
  const char *cl;

  memset(r, 0, sizeof(*r));
  buf[0] = 0;
  while(!(end = strstr(buf, "\r\n\r\n"))) {
    ssize_t n;
    if(len >= MAX_REQ_HEADER) return -1;
    n = recv(fd, buf + len, MAX_REQ_HEADER - len, 0);
    if(n < 0 && errno == EINTR) continue;
    if(n <= 0) return 1;
    len += n;
    buf[len] = 0;
  }
  *end = 0;
  hdr_total = (end + 4) - buf;
  have = len - hdr_total;

  line = strtok_r(buf, "\r\n", &save);
  if(!line || sscanf(line, "%15s %8191s", r->method, r->target) != 2) {
    return -1;
  }
  r->http10 = strstr(line, "HTTP/1.0") != 0;

  while((line = strtok_r(0, "\r\n", &save)) && r->nheaders < MAX_HEADERS) {
    char *colon = strchr(line, ':');
    if(!colon) continue;
    *colon++ = 0;
    while(*colon == ' ' || *colon == '\t') colon++;
    r->hname[r->nheaders] = line;
    r->hval[r->nheaders] = colon;
    r->nheaders++;
  }

  if(req_header(r, "transfer-encoding")) return -2;
  if((cl = req_header(r, "content-length"))) want = strtoull(cl, 0, 10);
  if(want > MAX_REQ_BODY) return -3;
  if(want) {
    size_t take = have < want ? have : want;
    if(!(r->body = malloc(want + 1))) return -1;
    memcpy(r->body, end + 4, take);
    while(take < want) {
      ssize_t n = recv(fd, r->body + take, want - take, 0);
      if(n < 0 && errno == EINTR) continue;
      if(n <= 0) return 1;
      take += n;
    }
    r->body[want] = 0;
    r->body_len = want;
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* cabeceras                                                           */
/* ------------------------------------------------------------------ */

static int
is_hop_header(const char *n) {
  static const char *hop[] = {
    "connection", "keep-alive", "proxy-connection", "transfer-encoding",
    "te", "trailer", "upgrade", "content-length", "content-encoding", 0
  };
  for(int i = 0; hop[i]; i++) {
    if(!strcasecmp(n, hop[i])) return 1;
  }
  return 0;
}

static int
is_blocked_resp_header(const char *n) {
  static const char *blk[] = {
    "content-security-policy", "content-security-policy-report-only",
    "strict-transport-security", "x-frame-options", "alt-svc",
    "report-to", "nel", "reporting-endpoints", "x-xss-protection",
    "cross-origin-embedder-policy", 0
  };
  for(int i = 0; blk[i]; i++) {
    if(!strcasecmp(n, blk[i])) return 1;
  }
  return is_hop_header(n);
}

/* Cambia el prefijo "https://discord.com" por nuestro origen. */
static void
rewrite_origin_prefix(const char *in, const char *from, const char *to,
                      char *out, size_t out_size) {
  size_t flen = strlen(from);
  if(!strncmp(in, from, flen) &&
     (in[flen] == 0 || in[flen] == '/' || in[flen] == '?')) {
    snprintf(out, out_size, "%s%s", to, in + flen);
  } else {
    snprintf(out, out_size, "%s", in);
  }
}

/* ------------------------------------------------------------------ */
/* proxy                                                               */
/* ------------------------------------------------------------------ */

typedef struct fwd_opts {
  int rewrite_html;      /* inyectar Vencord y reescribir URLs */
  int pass_cookies;      /* reenviar Cookie / Set-Cookie */
  int follow_redirects;  /* para /__vc/fetch */
} fwd_opts_t;

static int
forward(int fd, req_t *r, const char *url, const fwd_opts_t *o) {
  up_header_t hdrs[MAX_HEADERS + 4];
  char origin_hdr[512], referer_hdr[2048];
  char cururl[8192];
  up_resp_t resp;
  int nh = 0, keep = !r->http10, is_html = 0, no_body, redirects = 0;
  char out[16384];
  size_t olen = 0;

  for(int i = 0; i < r->nheaders && nh < MAX_HEADERS; i++) {
    const char *n = r->hname[i], *v = r->hval[i];
    if(!strcasecmp(n, "connection") && !strcasecmp(v, "close")) keep = 0;
    if(is_hop_header(n) || !strcasecmp(n, "host") ||
       !strcasecmp(n, "accept-encoding") || !strcasecmp(n, "user-agent") ||
       !strncasecmp(n, "sec-fetch-", 10) || !strcasecmp(n, "x-vc-fetch")) {
      continue;
    }
    if(!strcasecmp(n, "cookie") && !o->pass_cookies) continue;
    if(!strcasecmp(n, "origin")) {
      if(!o->pass_cookies) continue;
      rewrite_origin_prefix(v, g_cfg.self_origin, g_cfg.upstream,
                            origin_hdr, sizeof(origin_hdr));
      v = origin_hdr;
    }
    if(!strcasecmp(n, "referer")) {
      if(!o->pass_cookies) continue;
      rewrite_origin_prefix(v, g_cfg.self_origin, g_cfg.upstream,
                            referer_hdr, sizeof(referer_hdr));
      v = referer_hdr;
    }
    hdrs[nh].name = n;
    hdrs[nh].value = v;
    nh++;
  }
  hdrs[nh].name = "User-Agent";
  hdrs[nh].value = VC_SPOOF_UA;
  nh++;
  hdrs[nh].name = 0;
  hdrs[nh].value = 0;

  snprintf(cururl, sizeof(cururl), "%s", url);
  for(;;) {
    if(up_request(r->method, cururl, hdrs, r->body, r->body_len, &resp)) {
      char msg[9000];
      snprintf(msg, sizeof(msg),
               "Vencord PS5: no se pudo conectar con %s\n"
               "Comprueba la conexion a Internet de la consola.\n", cururl);
      send_text(fd, 502, msg);
      return keep;
    }
    if(o->follow_redirects && redirects < 5 &&
       resp.status >= 301 && resp.status <= 308 && resp.status != 304) {
      const char *h = resp.headers, *found = 0;
      while(h && *h) {
        if(!strncasecmp(h, "location:", 9)) { found = h + 9; break; }
        h = strchr(h, '\n');
        if(h) h++;
      }
      if(found) {
        while(*found == ' ') found++;
        size_t l = strcspn(found, "\r\n");
        char next[8192];
        snprintf(next, sizeof(next), "%.*s", (int)l, found);
        if(!strncmp(next, "http://", 7) || !strncmp(next, "https://", 8)) {
          snprintf(cururl, sizeof(cururl), "%s", next);
          up_close(&resp);
          redirects++;
          continue;
        }
      }
    }
    break;
  }

  no_body = !strcmp(r->method, "HEAD") || resp.status == 204 ||
            resp.status == 304 || (resp.status >= 100 && resp.status < 200);

  olen = snprintf(out, sizeof(out), "HTTP/1.1 %d %s\r\n", resp.status,
                  reason(resp.status));

  /* cabeceras de respuesta */
  {
    char *save = 0, *line;
    char *copy = strdup(resp.headers ? resp.headers : "");
    for(line = strtok_r(copy, "\r\n", &save); line;
        line = strtok_r(0, "\r\n", &save)) {
      char *colon, *v;
      char tmp[8192];
      if(!strncmp(line, "HTTP/", 5)) continue;
      if(!(colon = strchr(line, ':'))) continue;
      *colon = 0;
      v = colon + 1;
      while(*v == ' ') v++;
      if(is_blocked_resp_header(line)) continue;
      if(!strcasecmp(line, "content-type") && strstr(v, "text/html")) {
        is_html = 1;
      }
      if(!strcasecmp(line, "set-cookie")) {
        if(!o->pass_cookies) continue;
        vc_rewrite_set_cookie(v, tmp, sizeof(tmp));
        v = tmp;
      } else if(!strcasecmp(line, "location") && o->rewrite_html) {
        rewrite_origin_prefix(v, g_cfg.upstream, g_cfg.self_origin, tmp,
                              sizeof(tmp));
        v = tmp;
      }
      if(olen + strlen(line) + strlen(v) + 8 < sizeof(out) - 256) {
        olen += snprintf(out + olen, sizeof(out) - olen, "%s: %s\r\n", line,
                         v);
      }
    }
    free(copy);
  }

  if(no_body) {
    olen += snprintf(out + olen, sizeof(out) - olen,
                     "Content-Length: 0\r\n%s\r\n",
                     keep ? "" : "Connection: close\r\n");
    send_all(fd, out, olen);
    up_close(&resp);
    return keep;
  }

  olen += snprintf(out + olen, sizeof(out) - olen,
                   "Transfer-Encoding: chunked\r\n%s\r\n",
                   keep ? "" : "Connection: close\r\n");
  if(send_all(fd, out, olen)) {
    up_close(&resp);
    return 0;
  }

  if(is_html && o->rewrite_html) {
    size_t cap = 256 * 1024, len = 0, l1, l2, l3;
    char *body = malloc(cap), *b1, *b2, *b3;
    char https_up[300], self_noscheme[80], up_noscheme[300];
    ssize_t n;
    const char *snippet =
      "<script src=\"/__vc/prelude.js\"></script>"
      "<script src=\"/__vc/vencord.js\"></script>";

    while(body && (n = up_read(&resp, body + len, cap - len)) > 0) {
      len += n;
      if(len == cap) {
        if(cap >= MAX_HTML_BODY) break;
        char *nb = realloc(body, cap * 2);
        if(!nb) break;
        body = nb;
        cap *= 2;
      }
    }
    up_close(&resp);
    if(!body) return 0;

    /* https://discord.com -> http://127.0.0.1:PUERTO y
     * //discord.com (protocol-relative, en GLOBAL_ENV) -> //127.0.0.1:PUERTO */
    snprintf(https_up, sizeof(https_up), "%s", g_cfg.upstream);
    snprintf(up_noscheme, sizeof(up_noscheme), "%s",
             strstr(g_cfg.upstream, "//") ? strstr(g_cfg.upstream, "//") :
             g_cfg.upstream);
    snprintf(self_noscheme, sizeof(self_noscheme), "%s",
             strstr(g_cfg.self_origin, "//"));

    b1 = vc_replace_all(body, len, https_up, g_cfg.self_origin, &l1);
    free(body);
    b2 = b1 ? vc_replace_all(b1, l1, up_noscheme, self_noscheme, &l2) : 0;
    free(b1);
    b3 = b2 ? vc_inject_head(b2, l2, snippet, &l3) : 0;
    free(b2);
    if(!b3) return 0;
    int err = send_chunk(fd, b3, l3);
    free(b3);
    if(err || send_all(fd, "0\r\n\r\n", 5)) return 0;
    return keep;
  }

  /* resto: streaming */
  {
    char buf[64 * 1024];
    ssize_t n;
    while((n = up_read(&resp, buf, sizeof(buf))) > 0) {
      if(send_chunk(fd, buf, n)) {
        up_close(&resp);
        return 0;
      }
    }
    up_close(&resp);
    if(n < 0) return 0; /* cortamos sin el chunk final: el navegador lo ve como error */
    if(send_all(fd, "0\r\n\r\n", 5)) return 0;
  }
  return keep;
}

/* ------------------------------------------------------------------ */
/* rutas internas /__vc/                                               */
/* ------------------------------------------------------------------ */

/* Protege los endpoints internos frente a otras webs abiertas en el
 * navegador: el Origin, si viene, debe ser el nuestro. */
static int
same_origin(const req_t *r) {
  const char *origin = req_header(r, "origin");
  return !origin || !strcmp(origin, g_cfg.self_origin);
}

static int
handle_internal(int fd, req_t *r) {
  const char *path = r->target + 5; /* tras "/__vc" */
  int keep = !r->http10;

  if(!strncmp(path, "/ping", 5)) {
    send_simple(fd, 200, "text/plain", "Access-Control-Allow-Origin: *\r\n",
                "ok", 2);
  } else if(!strncmp(path, "/prelude.js", 11)) {
    send_simple(fd, 200, "application/javascript; charset=utf-8", 0,
                VC_PRELUDE_JS, strlen(VC_PRELUDE_JS));
  } else if(!strncmp(path, "/vencord.js", 11)) {
    size_t len = 0;
    const char *js = vencord_get(&len);
    if(js) {
      /* Tampermonkey ejecuta el userscript dentro de una funcion; si se
       * ejecuta suelto, "var Vencord" choca con el defineProperty que el
       * propio script hace sobre window. */
      static const char pre[] = "(function(){\n";
      static const char post[] = "\n})();\n";
      char hdr[256];
      snprintf(hdr, sizeof(hdr),
               "HTTP/1.1 200 OK\r\n"
               "Content-Type: application/javascript; charset=utf-8\r\n"
               "Content-Length: %zu\r\n"
               "Cache-Control: no-cache\r\n\r\n",
               strlen(pre) + len + strlen(post));
      if(send_all(fd, hdr, strlen(hdr)) || send_all(fd, pre, strlen(pre)) ||
         send_all(fd, js, len) || send_all(fd, post, strlen(post))) {
        return 0;
      }
    } else {
      static const char fallback[] =
        "console.error('[Vencord PS5] No se pudo cargar Vencord. "
        "Abre http://127.0.0.1:" "' + location.port + '/__vc/ para reintentar.');";
      send_simple(fd, 200, "application/javascript; charset=utf-8", 0,
                  fallback, strlen(fallback));
    }
  } else if(!strncmp(path, "/update", 7)) {
    char msg[512];
    if(!same_origin(r) || strcmp(r->method, "POST")) {
      send_text(fd, 403, "forbidden");
    } else {
      int err = vencord_update(msg, sizeof(msg));
      send_text(fd, err ? 502 : 200, msg);
    }
  } else if(!strncmp(path, "/fetch", 6)) {
    /* Puente para GM_xmlhttpRequest de Vencord (temas, plugins que
     * descargan recursos de otros dominios). Requiere cabecera propia:
     * otras webs no pueden enviarla sin un preflight CORS que denegamos. */
    char url[8192];
    fwd_opts_t o = {0, 0, 1};
    if(!same_origin(r) || !req_header(r, "x-vc-fetch")) {
      send_text(fd, 403, "forbidden");
    } else if(query_param(r->target, "url", url, sizeof(url)) ||
              (strncmp(url, "https://", 8) && strncmp(url, "http://", 7))) {
      send_text(fd, 400, "bad url");
    } else {
      return forward(fd, r, url, &o);
    }
  } else if(!strncmp(path, "/login", 6)) {
    send_simple(fd, 200, "text/html; charset=utf-8", 0, VC_LOGIN_HTML,
                strlen(VC_LOGIN_HTML));
  } else if(!strcmp(path, "/") || !strcmp(path, "")) {
    send_simple(fd, 200, "text/html; charset=utf-8", 0, VC_HOME_HTML,
                strlen(VC_HOME_HTML));
  } else {
    send_text(fd, 404, "not found");
  }
  return keep;
}

static int
host_ok(const req_t *r) {
  const char *h = req_header(r, "host");
  char a[64], b[64];
  if(!h) return 0;
  snprintf(a, sizeof(a), "127.0.0.1:%d", g_cfg.port);
  snprintf(b, sizeof(b), "localhost:%d", g_cfg.port);
  return !strcasecmp(h, a) || !strcasecmp(h, b);
}

static void *
conn_thread(void *arg) {
  int fd = (int)(intptr_t)arg;
  char *buf = malloc(MAX_REQ_HEADER + 1);
  struct timeval tv = {120, 0};
  int one = 1;

  setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
  setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof(one));

  while(buf) {
    req_t r;
    int keep, err = read_request(fd, buf, &r);

    if(err == 1 || err == -1) {
      free(r.body);
      break;
    }
    if(err == -2) {
      send_text(fd, 411, "chunked request bodies are not supported");
      keep = 0;
    } else if(err == -3) {
      send_text(fd, 413, "too large");
      keep = 0;
    } else if(!host_ok(&r)) {
      send_text(fd, 403, "bad host");
      keep = 0;
    } else if(!strncmp(r.target, "/__vc", 5) &&
              (r.target[5] == 0 || r.target[5] == '/' || r.target[5] == '?')) {
      keep = handle_internal(fd, &r);
    } else if(!strcmp(r.target, "/")) {
      char loc[128];
      snprintf(loc, sizeof(loc), "Location: %s/app\r\n", g_cfg.self_origin);
      send_simple(fd, 302, "text/plain", loc, "", 0);
      keep = !r.http10;
    } else {
      char url[9000];
      fwd_opts_t o = {1, 1, 0};
      snprintf(url, sizeof(url), "%s%s", g_cfg.upstream, r.target);
      keep = forward(fd, &r, url, &o);
    }

    free(r.body);
    if(!keep) break;
  }

  free(buf);
  close(fd);
  return 0;
}

int
proxy_listen(int *in_use) {
  struct sockaddr_in sa = {0};
  int fd, one = 1;

  *in_use = 0;
  if((fd = socket(AF_INET, SOCK_STREAM, 0)) < 0) {
    perror("socket");
    return -1;
  }
  setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));
  sa.sin_family = AF_INET;
  sa.sin_port = htons(g_cfg.port);
  sa.sin_addr.s_addr = inet_addr(VC_LISTEN_ADDR);
  if(bind(fd, (struct sockaddr *)&sa, sizeof(sa))) {
    *in_use = (errno == EADDRINUSE);
    perror("bind");
    close(fd);
    return -1;
  }
  if(listen(fd, 64)) {
    perror("listen");
    close(fd);
    return -1;
  }
  return fd;
}

void
proxy_serve(int listen_fd) {
  for(;;) {
    pthread_t th;
    pthread_attr_t attr;
    int cfd = accept(listen_fd, 0, 0);
    if(cfd < 0) {
      if(errno == EINTR) continue;
      perror("accept");
      usleep(100000);
      continue;
    }
    pthread_attr_init(&attr);
    pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
    pthread_attr_setstacksize(&attr, 512 * 1024);
    if(pthread_create(&th, &attr, conn_thread, (void *)(intptr_t)cfd)) {
      close(cfd);
    }
    pthread_attr_destroy(&attr);
  }
}
