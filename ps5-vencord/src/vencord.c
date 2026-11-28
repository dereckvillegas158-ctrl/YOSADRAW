/* Descarga y cache de Vencord.user.js (build web oficial de Vencord). */
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>

#include "config.h"
#include "upstream.h"
#include "vencord.h"

static pthread_mutex_t g_lock = PTHREAD_MUTEX_INITIALIZER;
static char  *g_js;
static size_t g_js_len;

static void
cache_path(char *out, size_t size) {
  snprintf(out, size, "%s/Vencord.user.js", g_cfg.data_dir);
}

static char *
read_file(const char *path, size_t *len) {
  FILE *f = fopen(path, "rb");
  char *buf;
  long size;

  if(!f) return 0;
  fseek(f, 0, SEEK_END);
  size = ftell(f);
  fseek(f, 0, SEEK_SET);
  if(size <= 0 || !(buf = malloc(size + 1))) {
    fclose(f);
    return 0;
  }
  if(fread(buf, 1, size, f) != (size_t)size) {
    free(buf);
    fclose(f);
    return 0;
  }
  fclose(f);
  buf[size] = 0;
  *len = size;
  return buf;
}

static int
write_file(const char *path, const char *data, size_t len) {
  char tmp[600];
  FILE *f;

  snprintf(tmp, sizeof(tmp), "%s.tmp", path);
  if(!(f = fopen(tmp, "wb"))) return -1;
  if(fwrite(data, 1, len, f) != len) {
    fclose(f);
    remove(tmp);
    return -1;
  }
  fclose(f);
  return rename(tmp, path);
}

char *
vc_http_get(const char *url, size_t *len, int *status) {
  static const up_header_t hdrs[] = {
    {"User-Agent", VC_SPOOF_UA},
    {"Accept", "*/*"},
    {0, 0}
  };
  char cur[2048];
  up_resp_t r;

  *len = 0;
  *status = 0;
  snprintf(cur, sizeof(cur), "%s", url);
  for(int hop = 0; hop < 6; hop++) {
    if(up_request("GET", cur, hdrs, 0, 0, &r)) return 0;
    *status = r.status;
    if(r.status >= 301 && r.status <= 308 && r.status != 304) {
      const char *h = r.headers, *loc = 0;
      while(h && *h) {
        if(!strncasecmp(h, "location:", 9)) { loc = h + 9; break; }
        h = strchr(h, '\n');
        if(h) h++;
      }
      if(!loc) break;
      while(*loc == ' ') loc++;
      snprintf(cur, sizeof(cur), "%.*s", (int)strcspn(loc, "\r\n"), loc);
      up_close(&r);
      continue;
    }
    if(r.status != 200) break;

    size_t cap = 1024 * 1024, n = 0;
    char *buf = malloc(cap + 1);
    ssize_t k;
    while(buf && (k = up_read(&r, buf + n, cap - n)) > 0) {
      n += k;
      if(n == cap) {
        char *nb = realloc(buf, cap * 2 + 1);
        if(!nb) { free(buf); buf = 0; break; }
        buf = nb;
        cap *= 2;
      }
    }
    up_close(&r);
    if(!buf || k < 0) { free(buf); return 0; }
    buf[n] = 0;
    *len = n;
    return buf;
  }
  up_close(&r);
  return 0;
}

static int
download_locked(char *msg, size_t msg_size) {
  char path[512];
  size_t len;
  int status;
  char *js = vc_http_get(g_cfg.vencord_url, &len, &status);

  if(!js || len < 1024 || !strstr(js, "Vencord")) {
    snprintf(msg, msg_size, "No se pudo descargar Vencord (HTTP %d) desde %s",
             status, g_cfg.vencord_url);
    free(js);
    return -1;
  }
  mkdir(g_cfg.data_dir, 0755);
  cache_path(path, sizeof(path));
  if(write_file(path, js, len)) {
    printf("[vc] aviso: no se pudo guardar la cache en %s\n", path);
  }
  free(g_js);
  g_js = js;
  g_js_len = len;
  snprintf(msg, msg_size, "Vencord actualizado (%zu KB). Recarga Discord.",
           len / 1024);
  printf("[vc] %s\n", msg);
  return 0;
}

const char *
vencord_get(size_t *len) {
  char path[512], msg[512];

  pthread_mutex_lock(&g_lock);
  if(!g_js) {
    cache_path(path, sizeof(path));
    if((g_js = read_file(path, &g_js_len))) {
      printf("[vc] Vencord cargado desde %s\n", path);
    } else {
      download_locked(msg, sizeof(msg));
    }
  }
  *len = g_js_len;
  pthread_mutex_unlock(&g_lock);
  /* g_js solo se reemplaza en vencord_update; una peticion en curso puede
   * seguir usando el puntero viejo, por eso no se libera alli (fuga minima
   * y solo al actualizar manualmente). */
  return g_js;
}

int
vencord_update(char *msg, size_t msg_size) {
  int err;
  char *old;

  pthread_mutex_lock(&g_lock);
  old = g_js;
  g_js = 0; /* evita el free() dentro de download_locked */
  err = download_locked(msg, msg_size);
  if(err) {
    g_js = old; /* conservamos la version anterior */
  }
  pthread_mutex_unlock(&g_lock);
  return err;
}
