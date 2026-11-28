/* Backend PS5: usa libSceHttp + libSceSsl del firmware para hablar HTTPS
 * con discord.com sin tener que portar una libreria TLS. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "config.h"
#include "upstream.h"

int sceNetInit(void);
int sceNetPoolCreate(const char *, int, int);
int sceSslInit(size_t);
int sceHttpInit(int, int, size_t);
int sceHttpCreateTemplate(int, const char *, int, int);
int sceHttpSetResponseHeaderMaxSize(int, size_t);
int sceHttpsSetSslCallback(int, void *, void *);
int sceHttpSetAutoRedirect(int, int);
int sceHttpSetCookieEnabled(int, int);
int sceHttpSetAcceptEncodingGZIPEnabled(int, int);
int sceHttpSetRecvTimeOut(int, uint32_t);
int sceHttpSetConnectTimeOut(int, uint32_t);
int sceHttpCreateConnectionWithURL(int, const char *, int);
int sceHttpDeleteConnection(int);
int sceHttpCreateRequestWithURL2(int, const char *, const char *, uint64_t);
int sceHttpAddRequestHeader(int, const char *, const char *, uint32_t);
int sceHttpRemoveRequestHeader(int, const char *);
int sceHttpSendRequest(int, const void *, size_t);
int sceHttpGetStatusCode(int, int *);
int sceHttpGetAllResponseHeaders(int, char **, size_t *);
int sceHttpGetResponseContentLength(int, int *, uint64_t *);
int sceHttpReadData(int, void *, size_t);
int sceHttpDeleteRequest(int);

#define SCE_HTTP_HEADER_OVERWRITE 0
#define SCE_HTTP_HEADER_ADD       1
#define SCE_HTTP_VERSION_1_1      2

static int g_tmpl = -1;

typedef struct sce_priv {
  int conn;
  int req;
} sce_priv_t;

/* Llamado cuando la verificacion del certificado falla: 0 = aceptar. */
static int
ssl_accept_all_cb(void) {
  return 0;
}

int
up_init(int insecure_tls) {
  int pool, ssl, http, err;

  if((err = sceNetInit()) < 0) {
    printf("[vc] sceNetInit: 0x%x\n", err);
    return -1;
  }
  if((pool = sceNetPoolCreate("vencord-ps5", 256 * 1024, 0)) < 0) {
    printf("[vc] sceNetPoolCreate: 0x%x\n", pool);
    return -1;
  }
  if((ssl = sceSslInit(1024 * 1024)) < 0) {
    printf("[vc] sceSslInit: 0x%x\n", ssl);
    return -1;
  }
  if((http = sceHttpInit(pool, ssl, 2 * 1024 * 1024)) < 0) {
    printf("[vc] sceHttpInit: 0x%x\n", http);
    return -1;
  }
  if((g_tmpl = sceHttpCreateTemplate(http, VC_SPOOF_UA,
                                     SCE_HTTP_VERSION_1_1, 1)) < 0) {
    printf("[vc] sceHttpCreateTemplate: 0x%x\n", g_tmpl);
    return -1;
  }

  /* Discord manda cabeceras enormes (CSP de varios KB). */
  sceHttpSetResponseHeaderMaxSize(g_tmpl, 64 * 1024);
  /* Las redirecciones se devuelven tal cual al navegador. */
  sceHttpSetAutoRedirect(g_tmpl, 0);
  /* Las cookies las gestiona el navegador, no la libreria. */
  sceHttpSetCookieEnabled(g_tmpl, 0);
  /* Queremos el cuerpo sin comprimir para poder reescribir el HTML. */
  sceHttpSetAcceptEncodingGZIPEnabled(g_tmpl, 0);
  sceHttpSetConnectTimeOut(g_tmpl, 15 * 1000 * 1000);
  sceHttpSetRecvTimeOut(g_tmpl, 120 * 1000 * 1000);

  if(insecure_tls) {
    printf("[vc] AVISO: verificacion TLS desactivada (--insecure)\n");
    sceHttpsSetSslCallback(g_tmpl, (void *)ssl_accept_all_cb, 0);
  }
  return 0;
}

int
up_request(const char *method, const char *url, const up_header_t *headers,
           const void *body, size_t body_len, up_resp_t *out) {
  sce_priv_t *p;
  char *hdr = 0;
  size_t hdr_len = 0;
  uint64_t clen = 0;
  int has_len = 0;
  int err;

  memset(out, 0, sizeof(*out));
  out->content_length = -1;

  if(!(p = calloc(1, sizeof(*p)))) {
    return -1;
  }
  p->conn = p->req = -1;

  if((p->conn = sceHttpCreateConnectionWithURL(g_tmpl, url, 1)) < 0) {
    printf("[vc] CreateConnection(%s): 0x%x\n", url, p->conn);
    goto fail;
  }
  if((p->req = sceHttpCreateRequestWithURL2(p->conn, method, url,
                                            body_len)) < 0) {
    printf("[vc] CreateRequest(%s %s): 0x%x\n", method, url, p->req);
    goto fail;
  }

  for(int i = 0; headers && headers[i].name; i++) {
    uint32_t mode = SCE_HTTP_HEADER_ADD;
    if(!strcasecmp(headers[i].name, "user-agent")) {
      mode = SCE_HTTP_HEADER_OVERWRITE;
    }
    sceHttpAddRequestHeader(p->req, headers[i].name, headers[i].value, mode);
  }
  sceHttpAddRequestHeader(p->req, "Accept-Encoding", "identity",
                          SCE_HTTP_HEADER_OVERWRITE);

  if((err = sceHttpSendRequest(p->req, body_len ? body : 0, body_len)) < 0) {
    printf("[vc] SendRequest(%s): 0x%x\n", url, err);
    goto fail;
  }
  if((err = sceHttpGetStatusCode(p->req, &out->status)) < 0) {
    printf("[vc] GetStatusCode: 0x%x\n", err);
    goto fail;
  }

  if(sceHttpGetAllResponseHeaders(p->req, &hdr, &hdr_len) >= 0 && hdr) {
    if((out->headers = malloc(hdr_len + 1))) {
      memcpy(out->headers, hdr, hdr_len);
      out->headers[hdr_len] = 0;
    }
  }
  if(!out->headers) {
    out->headers = strdup("");
  }

  if(sceHttpGetResponseContentLength(p->req, &has_len, &clen) >= 0 &&
     has_len == 0) {
    /* result==0 significa que la longitud es conocida */
    out->content_length = (long long)clen;
  }

  out->priv = p;
  return 0;

fail:
  if(p->req >= 0) sceHttpDeleteRequest(p->req);
  if(p->conn >= 0) sceHttpDeleteConnection(p->conn);
  free(p);
  free(out->headers);
  out->headers = 0;
  return -1;
}

ssize_t
up_read(up_resp_t *r, void *buf, size_t len) {
  sce_priv_t *p = r->priv;
  int n;

  if(!p) {
    return 0;
  }
  n = sceHttpReadData(p->req, buf, len);
  return n < 0 ? -1 : n;
}

void
up_close(up_resp_t *r) {
  sce_priv_t *p = r->priv;

  if(p) {
    if(p->req >= 0) sceHttpDeleteRequest(p->req);
    if(p->conn >= 0) sceHttpDeleteConnection(p->conn);
    free(p);
  }
  free(r->headers);
  memset(r, 0, sizeof(*r));
}
