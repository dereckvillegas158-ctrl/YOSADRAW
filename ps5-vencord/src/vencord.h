#pragma once
#include <stddef.h>

/* Carga Vencord.user.js desde la cache en disco (o lo descarga si falta).
 * Devuelve un buffer compartido de solo lectura; no liberar. */
const char *vencord_get(size_t *len);
/* Fuerza la descarga de la ultima version. 0 = ok. */
int         vencord_update(char *msg, size_t msg_size);

/* Peticion GET siguiendo redirecciones; devuelve cuerpo malloc'd o NULL. */
char       *vc_http_get(const char *url, size_t *len, int *status);
