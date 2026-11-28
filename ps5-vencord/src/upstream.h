/* Cliente HTTP(S) hacia los servidores reales.
 * PS5: libSceHttp (TLS del sistema). Host/Linux: HTTP plano para pruebas. */
#pragma once
#include <stddef.h>
#include <sys/types.h>

typedef struct up_header {
  const char *name;
  const char *value;
} up_header_t;

typedef struct up_resp {
  int    status;
  char  *headers;     /* bloque "Nombre: valor\r\n..." (malloc, propiedad de up_resp) */
  long long content_length; /* -1 si es desconocido */
  void  *priv;
} up_resp_t;

int     up_init(int insecure_tls);
/* Devuelve 0 si ok. headers[] terminado con {NULL, NULL}. */
int     up_request(const char *method, const char *url,
                   const up_header_t *headers,
                   const void *body, size_t body_len, up_resp_t *out);
/* >0 bytes leidos, 0 fin, <0 error */
ssize_t up_read(up_resp_t *r, void *buf, size_t len);
void    up_close(up_resp_t *r);
/* Ultimo error de red legible (para notificaciones y /__vc/diag). */
const char *up_last_error(void);
/* 1 si se esta usando HTTPS sin verificar el certificado. */
int     up_tls_insecure(void);
/* Pruebas de conexion paso a paso para /__vc/diag. Devuelve bytes escritos. */
size_t  up_selftest(char *out, size_t size, const char *upstream);
