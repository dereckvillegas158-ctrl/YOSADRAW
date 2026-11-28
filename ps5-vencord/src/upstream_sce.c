/* Backend PS5: usa libSceHttp + libSceSsl del firmware para hablar HTTPS
 * con discord.com sin tener que portar una libreria TLS.
 *
 * Se imita el uso que hace websrv (que funciona en consolas liberadas):
 * metodo numerico, conexiones sin keep-alive y tamano maximo de cabeceras
 * que acepte el sistema. Ademas:
 *  - si la verificacion del certificado falla, se reintenta sin ella y se
 *    recuerda para las siguientes peticiones;
 *  - up_selftest() prueba varias variantes y muestra cada codigo de error
 *    (pagina /__vc/diag). */
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
int sceHttpDeleteTemplate(int);
int sceHttpSetResponseHeaderMaxSize(int, size_t);
int sceHttpsSetSslCallback(int, void *, void *);
int sceHttpsGetSslError(int, int *, uint32_t *);
int sceHttpSetAutoRedirect(int, int);
int sceHttpSetCookieEnabled(int, int);
int sceHttpSetAcceptEncodingGZIPEnabled(int, int);
int sceHttpSetRecvTimeOut(int, uint32_t);
int sceHttpSetConnectTimeOut(int, uint32_t);
int sceHttpCreateConnectionWithURL(int, const char *, int);
int sceHttpDeleteConnection(int);
int sceHttpCreateRequestWithURL(int, int, const char *, uint64_t);
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

static int g_http = -1;
static int g_tmpl_verify = -1;
static int g_tmpl_insecure = -1;
static size_t g_hdr_max;
static volatile int g_use_insecure;
static char g_last_error_msg[300];

typedef struct sce_priv {
  int conn;
  int req;
} sce_priv_t;

/* Llamado cuando la verificacion del certificado falla: 0 = aceptar. */
static int
ssl_accept_all_cb(void) {
  return 0;
}

/* Metodos que libSceHttp conoce por numero (como usa websrv). */
static int
method_id(const char *m) {
  static const char *names[] = {
    "GET", "POST", "HEAD", "OPTIONS", "PUT", "DELETE", "TRACE", "CONNECT", 0
  };
  for(int i = 0; names[i]; i++) {
    if(!strcmp(m, names[i])) return i;
  }
  return -1;
}

static int
set_header_max(int t) {
  static const size_t sizes[] = {64 * 1024, 32 * 1024, 16 * 1024, 0x2000, 0};
  for(int i = 0; sizes[i]; i++) {
    if(sceHttpSetResponseHeaderMaxSize(t, sizes[i]) >= 0) {
      return (int)sizes[i];
    }
  }
  return 0;
}

static int
make_template(int insecure) {
  int t, hm;

  t = sceHttpCreateTemplate(g_http, VC_SPOOF_UA, SCE_HTTP_VERSION_1_1, 1);
  if(t < 0) {
    printf("[vc] sceHttpCreateTemplate: 0x%08x\n", t);
    return t;
  }
  hm = set_header_max(t);
  if(!g_hdr_max) {
    g_hdr_max = hm;
    printf("[vc] tamano max. de cabeceras: %d\n", hm);
  }
  sceHttpSetAutoRedirect(t, 0);
  sceHttpSetCookieEnabled(t, 0);
  sceHttpSetAcceptEncodingGZIPEnabled(t, 0);
  sceHttpSetConnectTimeOut(t, 20 * 1000 * 1000);
  sceHttpSetRecvTimeOut(t, 120 * 1000 * 1000);
  if(insecure) {
    sceHttpsSetSslCallback(t, (void *)ssl_accept_all_cb, 0);
  }
  return t;
}

int
up_init(int insecure_tls) {
  int pool, ssl, err;

  if((err = sceNetInit()) < 0) {
    printf("[vc] sceNetInit: 0x%08x\n", err);
  }
  if((pool = sceNetPoolCreate("vencord-ps5", 128 * 1024, 0)) < 0) {
    snprintf(g_last_error_msg, sizeof(g_last_error_msg),
             "sceNetPoolCreate 0x%08x", pool);
    printf("[vc] %s\n", g_last_error_msg);
    return -1;
  }
  if((ssl = sceSslInit(512 * 1024)) < 0) {
    snprintf(g_last_error_msg, sizeof(g_last_error_msg),
             "sceSslInit 0x%08x", ssl);
    printf("[vc] %s\n", g_last_error_msg);
    return -1;
  }
  if((g_http = sceHttpInit(pool, ssl, 1024 * 1024)) < 0) {
    snprintf(g_last_error_msg, sizeof(g_last_error_msg),
             "sceHttpInit 0x%08x", g_http);
    printf("[vc] %s\n", g_last_error_msg);
    return -1;
  }
  if((g_tmpl_insecure = make_template(1)) < 0) {
    snprintf(g_last_error_msg, sizeof(g_last_error_msg),
             "sceHttpCreateTemplate 0x%08x", g_tmpl_insecure);
    return -1;
  }
  if(insecure_tls || (g_tmpl_verify = make_template(0)) < 0) {
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

/* Un intento con una plantilla concreta. Devuelve 0 si ok; si falla,
 * deja en *step y *err en que paso y con que codigo. */
static int
try_request(int tmpl, const char *method, const char *url,
            const up_header_t *headers, const void *body, size_t body_len,
            sce_priv_t *p, int *status, const char **step, int *err,
            int *ssl_err) {
  int e, mid = method_id(method);
  int ssl_num = 0;
  uint32_t ssl_detail = 0;

  *ssl_err = 0;
  p->conn = p->req = -1;

  if((p->conn = sceHttpCreateConnectionWithURL(tmpl, url, 0)) < 0) {
    *step = "CreateConnection";
    *err = p->conn;
    return -1;
  }
  if(mid >= 0) {
    p->req = sceHttpCreateRequestWithURL(p->conn, mid, url, body_len);
  } else {
    p->req = sceHttpCreateRequestWithURL2(p->conn, method, url, body_len);
  }
  if(p->req < 0) {
    *step = "CreateRequest";
    *err = p->req;
    priv_free(p);
    return -1;
  }

  for(int i = 0; headers && headers[i].name; i++) {
    uint32_t mode = SCE_HTTP_HEADER_ADD;
    if(!headers[i].value || !headers[i].value[0]) continue;
    if(!strcasecmp(headers[i].name, "user-agent")) {
      mode = SCE_HTTP_HEADER_OVERWRITE;
    }
    if((e = sceHttpAddRequestHeader(p->req, headers[i].name, headers[i].value,
                                    mode)) < 0) {
      printf("[vc] AddRequestHeader(%s): 0x%08x\n", headers[i].name, e);
    }
  }
  sceHttpAddRequestHeader(p->req, "Accept-Encoding", "identity",
                          SCE_HTTP_HEADER_OVERWRITE);

  if((e = sceHttpSendRequest(p->req, body_len ? body : 0, body_len)) < 0) {
    *step = "SendRequest";
    *err = e;
    if(sceHttpsGetSslError(p->req, &ssl_num, &ssl_detail) >= 0 &&
       (ssl_num || ssl_detail)) {
      *ssl_err = 1;
    }
    priv_free(p);
    return -1;
  }
  if((e = sceHttpGetStatusCode(p->req, status)) < 0) {
    *step = "GetStatusCode";
    *err = e;
    priv_free(p);
    return -1;
  }
  return 0;
}

static void
fill_response(sce_priv_t *p, up_resp_t *out) {
  char *hdr = 0;
  size_t hdr_len = 0;
  uint64_t clen = 0;
  int has_len = 0;

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
    out->content_length = (long long)clen;
  }
  out->priv = p;
}

int
up_request(const char *method, const char *url, const up_header_t *headers,
           const void *body, size_t body_len, up_resp_t *out) {
  const char *step = "?", *step2 = "?";
  int err = 0, err2 = 0, ssl_err = 0, ssl_err2 = 0, ok = 0;
  sce_priv_t *p;

  memset(out, 0, sizeof(*out));
  out->content_length = -1;
  if(!(p = calloc(1, sizeof(*p)))) {
    return -1;
  }

  if(!g_use_insecure && g_tmpl_verify >= 0) {
    ok = !try_request(g_tmpl_verify, method, url, headers, body, body_len, p,
                      &out->status, &step, &err, &ssl_err);
    if(!ok) {
      printf("[vc] %s %s: %s 0x%08x%s; reintento sin verificar TLS\n",
             method, url, step, (unsigned)err, ssl_err ? " (TLS)" : "");
    }
  }
  if(!ok) {
    ok = !try_request(g_tmpl_insecure, method, url, headers, body, body_len,
                      p, &out->status, &step2, &err2, &ssl_err2);
    if(ok && !g_use_insecure) {
      printf("[vc] la verificacion TLS falla aqui; se sigue sin ella\n");
      g_use_insecure = 1;
    }
    if(!ok) {
      step = step2;
      err = err2;
      ssl_err = ssl_err2;
    }
  }

  if(!ok) {
    snprintf(g_last_error_msg, sizeof(g_last_error_msg),
             "%s: %s 0x%08x%s", url, step, (unsigned)err,
             ssl_err ? " (TLS)" : "");
    printf("[vc] %s\n", g_last_error_msg);
    free(p);
    return -1;
  }
  fill_response(p, out);
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

/* ---------------------------------------------------------------------- */
/* autodiagnostico                                                         */
/* ---------------------------------------------------------------------- */

/* Peticion minima, identica a la de websrv: plantilla nueva con el tamano
 * de cabeceras indicado, GET numerico, sin cabeceras propias. */
static size_t
probe(char *out, size_t size, const char *label, const char *url,
      size_t hdr_max, int insecure) {
  int t, c = -1, r = -1, e, st = 0;
  size_t o = 0;

  o += snprintf(out + o, size - o, "- %s\n  %s\n  ", label, url);
  if((t = sceHttpCreateTemplate(g_http, VC_SPOOF_UA, SCE_HTTP_VERSION_1_1,
                                1)) < 0) {
    return o + snprintf(out + o, size - o, "CreateTemplate 0x%08x\n", t);
  }
  if(hdr_max && (e = sceHttpSetResponseHeaderMaxSize(t, hdr_max)) < 0) {
    o += snprintf(out + o, size - o, "(HeaderMaxSize %zu: 0x%08x) ", hdr_max,
                  e);
  }
  if(insecure) {
    sceHttpsSetSslCallback(t, (void *)ssl_accept_all_cb, 0);
  }
  sceHttpSetAutoRedirect(t, 0);
  if((c = sceHttpCreateConnectionWithURL(t, url, 0)) < 0) {
    o += snprintf(out + o, size - o, "CreateConnection 0x%08x\n", c);
  } else if((r = sceHttpCreateRequestWithURL(c, 0, url, 0)) < 0) {
    o += snprintf(out + o, size - o, "CreateRequest 0x%08x\n", r);
  } else if((e = sceHttpSendRequest(r, 0, 0)) < 0) {
    int sn = 0;
    uint32_t sd = 0;
    sceHttpsGetSslError(r, &sn, &sd);
    o += snprintf(out + o, size - o, "SendRequest 0x%08x (ssl %d/0x%x)\n",
                  (unsigned)e, sn, sd);
  } else if((e = sceHttpGetStatusCode(r, &st)) < 0) {
    o += snprintf(out + o, size - o, "GetStatusCode 0x%08x\n", (unsigned)e);
  } else {
    char *h = 0;
    size_t hl = 0;
    sceHttpGetAllResponseHeaders(r, &h, &hl);
    o += snprintf(out + o, size - o, "OK: HTTP %d, cabeceras %zu bytes\n",
                  st, hl);
  }
  if(r >= 0) sceHttpDeleteRequest(r);
  if(c >= 0) sceHttpDeleteConnection(c);
  sceHttpDeleteTemplate(t);
  return o;
}

size_t
up_selftest(char *out, size_t size, const char *upstream) {
  char url[512];
  size_t o = 0;

  o += snprintf(out + o, size - o,
                "Cabeceras max. aceptadas: %zu\nTLS: %s\n\n", g_hdr_max,
                g_use_insecure ? "sin verificar" : "verificado");
  o += probe(out + o, size - o, "HTTP sin cifrar (red/DNS)",
             "http://discord.com/robots.txt", 0x2000, 1);
  snprintf(url, sizeof(url), "%s/robots.txt", upstream);
  o += probe(out + o, size - o, "HTTPS como websrv (8 KB cabeceras)", url,
             0x2000, 1);
  o += probe(out + o, size - o, "HTTPS verificando certificado", url,
             g_hdr_max, 0);
  snprintf(url, sizeof(url), "%s/app", upstream);
  o += probe(out + o, size - o, "Pagina de Discord, 8 KB cabeceras", url,
             0x2000, 1);
  o += probe(out + o, size - o, "Pagina de Discord, cabeceras grandes", url,
             g_hdr_max, 1);
  return o;
}
