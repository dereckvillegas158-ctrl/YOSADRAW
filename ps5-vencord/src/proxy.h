#pragma once
#include <stddef.h>

/* Arranca el servidor en g_cfg.port. Devuelve el socket de escucha o -1.
 * *in_use = 1 si el puerto ya esta ocupado (otra instancia corriendo). */
int  proxy_listen(int *in_use);
/* Bucle de aceptacion (no vuelve). */
void proxy_serve(int listen_fd);

/* Utilidades expuestas para las pruebas. */
char *vc_replace_all(const char *src, size_t len, const char *from,
                     const char *to, size_t *out_len);
char *vc_inject_head(const char *src, size_t len, const char *snippet,
                     size_t *out_len);
void  vc_rewrite_set_cookie(const char *in, char *out, size_t out_size);
