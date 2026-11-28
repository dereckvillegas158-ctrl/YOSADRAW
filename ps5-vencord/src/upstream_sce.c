/* Backend PS5: usa libSceHttp + libSceSsl del firmware para hablar HTTPS
 * con discord.com sin tener que portar una libreria TLS.
 *
 * Desde un payload, la verificacion de certificados de libSceSsl falla a
 * menudo (websrv, por ejemplo, la desactiva siempre). Por eso se usan dos
 * plantillas: primero se intenta con verificacion y, si la conexion falla,
 * se reintenta sin ella y se recuerda para las siguientes peticiones. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>

#include "config.h"
#include "upstream.h"

int sceNetInit(void);
int sceNetPoolCreate(const char *, int, int);
int sceSslInit(size_t);
int sceHttpInit(int, int, size_t);
int sceHttpCreateTemplate(int, const char *, int, int);
int sceHttpSetResponseHeaderMaxSize(int, size_t);
int sceHttpsSetSslCallback(int, void *, void *);
int sceHttpsDisableOption(int, uint32_t);
int sceHttpsGetSslError(int, int *, uint32_t *);
int sceHttpSetAutoRedirect(int, int);
int sceHttpSetCookieEnabled(int, int);
int sceHttpSetAcceptEncodingGZIPEnabled(int, int);
int sceHttpSetRecvTimeOut(int, uint32_t);
int sceHttpSetConnectTimeOut(int, uint32_t);
int sceHttpCreateConnectionWithURL(int, const char *, int);
int sceHttpDeleteConnection(int);
int sceHttpCreateRequestWithURL2(int, const char *, const char *, uint64_t);
int sceHttpAddRequestHeader(int, const char *, const char *, uint32_t);
int sceHttpSendRequest(int, const void *, size_t);
int sceHttpGetStatusCode(int, int *);
int sceHttpGetAllResponseHeaders(int, char **, size_t *);
int sceHttpGetResponseContentLength(int, int *, uint64_t *);
int sceHttpReadData(int, void *, size_t);
int sceHttpDeleteRequest(int);

#define SCE_HTTP_HEADER_OVERWRITE   0
#define SCE_HTTP_HEADER_ADD         1
#define SCE_HTTP_VERSION_1_1        2
#define SCE_HTTPS_FLAG_SERVER_VERIFY 0x01

static int g_http = -1;
static int g_tmpl_verify = -1;
static int g_tmpl_insecure = -1;
static volatile int g_use_insecure;
static volatile int g_last_error;
static char g_last_error_msg[256];

typedef struct sce_priv {
  int conn;
  int req;
} sce_priv_t;

/* Llamado cuando la verificacion del certificado falla: 0 = aceptar. */
static int
ssl_accept_all_cb(void) {
  return 0;
}

static int
make_template(int insecure) {
  int t = sceHttpCreateTemplate(g_http, VC_SPOOF_UA, SCE_HTTP_VERSION_1_1, 1);
  if(t < 0) {
    printf("[vc] sceHttpCreateTemplate: 0x%08x\n", t);
    return t;
  }
  /* Discord manda cabeceras enormes (CSP de varios KB). */
  sceHttpSetResponseHeaderMaxSize(t, 64 * 1024);
  /* Las redirecciones se devuelven tal cual al navegador. */
  sceHttpSetAutoRedirect(t, 0);
  /* Las cookies las gestiona el navegador, no la libreria. */
  sceHttpSetCookieEnabled(t, 0);
  /* Queremos el cuerpo sin comprimir para poder reescribir el HTML. */
  sceHttpSetAcceptEncodingGZIPEnabled(t, 0);
  sceHttpSetConnectTimeOut(t, 20 * 1000 * 1000);
  sceHttpSetRecvTimeOut(t, 120 * 1000 * 1000);
  if(insecure) {
    sceHttpsDisableOption(t, SCE_HTTPS_FLAG_SERVER_VERIFY);
    sceHttpsSetSslCallback(t, (void *)ssl_accept_all_cb, 0);
  }
  return t;
}

int
up_init(int insecure_tls) {
  int pool, ssl, err;

  if((err = sceNetInit()) < 0) {
    /* puede devolver error si ya estaba iniciada; no es fatal */
    printf("[vc] sceNetInit: 0x%08x\n", err);
  }
  if((pool = sceNetPoolCreate("vencord-ps5", 256 * 1024, 0)) < 0) {
    snprintf(g_last_error_msg, sizeof(g_last_error_msg),
             "sceNetPoolCreate 0x%08x", pool);
    printf("[vc] %s\n", g_last_error_msg);
    return -1;
  }
  if((ssl = sceSslInit(1024 * 1024)) < 0) {
    snprintf(g_last_error_msg, sizeof(g_last_error_msg),
             "sceSslInit 0x%08x", ssl);
    printf("[vc] %s\n", g_last_error_msg);
    return -1;
  }
  if((g_http = sceHttpInit(pool, ssl, 2 * 1024 * 1024)) < 0) {
    snprintf(g_last_error_msg, sizeof(g_last_error_msg),
             "sceHttpInit 0x%08x", g_http);
    printf("[vc] %s\n", g_last_error_msg);
    return -1;
  }
  if((g_tmpl_insecure = make_template(1)) < 0) {
    return -1;
  }
  if(insecure_tls) {
    g_use_insecure = 1;
  } else if((g_tmpl_verify = make_template(0)) < 0) {
    g_use_insecure = 1;
  }
  return 0;
}

static void
priv_free(sce_priv_t *p) {
  if(p->req >= 0) sceHttpDeleteRequest(p->req);
  if(p->conn >= 0) sceHttpDeleteConnection(p->conn);
  p->req = p->conn = -1;
}

/* Un intento con una plantilla concreta. 0 = ok; si falla, *err tiene el
 * codigo SCE y *ssl_err indica si fue un error TLS. */
static int
try_request(int tmpl, const char *method, const char *url,
            const up_header_t *headers, const void *body, size_t body_len,
            sce_priv_t *p, int *status, int *err, int *ssl_err) {
  int e;
  int ssl_num = 0;
  uint32_t ssl_detail = 0;

  *ssl_err = 0;
  p->conn = p->req = -1;

  if((p->conn = sceHttpCreateConnectionWithURL(tmpl, url, 1)) < 0) {
    *err = p->conn;
    printf("[vc] CreateConnection(%s): 0x%08x\n", url, *err);
    return -1;
  }
  if((p->req = sceHttpCreateRequestWithURL2(p->conn, method, url,
                                            body_len)) < 0) {
    *err = p->req;
    printf("[vc] CreateRequest(%s %s): 0x%08x\n", method, url, *err);
    priv_free(p);
    return -1;
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

  if((e = sceHttpSendRequest(p->req, body_len ? body : 0, body_len)) < 0) {
    *err = e;
    if(sceHttpsGetSslError(p->req, &ssl_num, &ssl_detail) >= 0 &&
       (ssl_num || ssl_detail)) {
      *ssl_err = 1;
      printf("[vc] SendRequest(%s): 0x%08x (TLS %d / 0x%x)\n", url, e,
             ssl_num, ssl_detail);
    } else {
      printf("[vc] SendRequest(%s): 0x%08x\n", url, e);
    }
    priv_free(p);
    return -1;
  }
  if((e = sceHttpGetStatusCode(p->req, status)) < 0) {
    *err = e;
    printf("[vc] GetStatusCode(%s): 0x%08x\n", url, e);
    priv_free(p);
    return -1;
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
  int err = 0, ssl_err = 0, ok;

  memset(out, 0, sizeof(*out));
  out->content_length = -1;

  if(!(p = calloc(1, sizeof(*p)))) {
    return -1;
  }

  if(!g_use_insecure && g_tmpl_verify >= 0) {
    ok = !try_request(g_tmpl_verify, method, url, headers, body, body_len, p,
                      &out->status, &err, &ssl_err);
    if(!ok) {
      /* Reintento sin verificar el certificado. Si asi funciona, el fallo
       * era de TLS y no merece la pena volver a intentarlo verificado. */
      ok = !try_request(g_tmpl_insecure, method, url, headers, body,
                        body_len, p, &out->status, &err, &ssl_err);
      if(ok) {
        if(!g_use_insecure) {
          printf("[vc] la verificacion TLS falla en este sistema; "
                 "se continua sin ella\n");
        }
        g_use_insecure = 1;
      }
    }
  } else {
    ok = !try_request(g_tmpl_insecure, method, url, headers, body, body_len,
                      p, &out->status, &err, &ssl_err);
  }

  if(!ok) {
    g_last_error = err;
    snprintf(g_last_error_msg, sizeof(g_last_error_msg), "%s 0x%08x%s",
             url, (unsigned)err, ssl_err ? " (TLS)" : "");
    free(p);
    return -1;
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
}

ssize_t
up_read(up_resp_t *r, void *buf, size_t len) {
  sce_priv_t *p = r->priv;
  int n;

  if(!p) {
    return 0;
  }
  n = sceHttpReadData(p->req, buf, len);
  if(n < 0) {
    printf("[vc] ReadData: 0x%08x\n", n);
    return -1;
  }
  return n;
}

void
up_close(up_resp_t *r) {
  sce_priv_t *p = r->priv;

  if(p) {
    priv_free(p);
    free(p);
  }
  free(r->headers);
  memset(r, 0, sizeof(*r));
}

const char *
up_last_error(void) {
  return g_last_error_msg[0] ? g_last_error_msg : "sin errores";
}

int
up_tls_insecure(void) {
  return g_use_insecure;
}
