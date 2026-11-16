package com.yosadraw.app;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Archivos de YOSADRAW en Android.
 * - Preferencias y biblioteca: archivos privados de la app (sobreviven a cierres y reinicios).
 * - Exportación: los datos llegan por trozos a un temporal y al terminar se publican con
 *   MediaStore (Android 10+) en Imágenes/YOSADRAW (imágenes) o Descargas/YOSADRAW (PDF, ZIP, JSON).
 *   En Android 7–9 se escribe en la carpeta pública con el permiso de almacenamiento.
 * - Abrir y compartir el archivo exportado con otras apps.
 */
@CapacitorPlugin(
    name = "YosaFiles",
    permissions = { @Permission(strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }, alias = "storage") }
)
public class YosaFilesPlugin extends Plugin {
    private static final String FOLDER = "YOSADRAW";
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    // ---------------- Datos privados ----------------

    private File dataFile(String name) throws IOException {
        if (name == null || !name.matches("[A-Za-z0-9._-]{1,80}")) throw new IOException("Nombre no válido");
        return new File(getContext().getFilesDir(), name);
    }

    @PluginMethod
    public void readText(PluginCall call) {
        io.execute(() -> {
            try {
                File f = dataFile(call.getString("name"));
                JSObject r = new JSObject();
                if (!f.exists()) { r.put("data", null); call.resolve(r); return; }
                byte[] b = readAll(new FileInputStream(f));
                r.put("data", new String(b, StandardCharsets.UTF_8));
                call.resolve(r);
            } catch (Exception e) { call.reject(e.getMessage()); }
        });
    }

    @PluginMethod
    public void writeText(PluginCall call) {
        io.execute(() -> {
            try {
                File f = dataFile(call.getString("name"));
                String data = call.getString("data", "");
                File tmp = new File(f.getPath() + ".part");
                try (FileOutputStream out = new FileOutputStream(tmp)) {
                    out.write(data.getBytes(StandardCharsets.UTF_8));
                    out.getFD().sync();
                }
                if (!tmp.renameTo(f)) throw new IOException("No se pudo guardar " + f.getName());
                call.resolve();
            } catch (Exception e) { call.reject(e.getMessage()); }
        });
    }

    // ---------------- Exportación por trozos ----------------

    private File partFile(String id) throws IOException {
        if (id == null || !id.matches("[a-f0-9-]{36}")) throw new IOException("Exportación no válida");
        File dir = new File(getContext().getCacheDir(), "export");
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("Sin espacio temporal");
        return new File(dir, id);
    }

    @PluginMethod
    public void beginExport(PluginCall call) {
        io.execute(() -> {
            try {
                String id = UUID.randomUUID().toString();
                File f = partFile(id);
                new FileOutputStream(f).close();
                JSObject r = new JSObject();
                r.put("id", id);
                call.resolve(r);
            } catch (Exception e) { call.reject(e.getMessage()); }
        });
    }

    @PluginMethod
    public void appendExport(PluginCall call) {
        io.execute(() -> {
            try {
                File f = partFile(call.getString("id"));
                byte[] b = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
                try (FileOutputStream out = new FileOutputStream(f, true)) { out.write(b); }
                call.resolve();
            } catch (Exception e) { call.reject("No se pudo escribir: " + e.getMessage()); }
        });
    }

    @PluginMethod
    public void abortExport(PluginCall call) {
        io.execute(() -> {
            try { partFile(call.getString("id")).delete(); } catch (Exception ignored) { }
            call.resolve();
        });
    }

    @PluginMethod
    public void finishExport(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storageGranted");
            return;
        }
        publish(call);
    }

    @PermissionCallback
    private void storageGranted(PluginCall call) {
        if (getPermissionState("storage") == PermissionState.GRANTED) publish(call);
        else call.reject("Sin permiso de almacenamiento: actívalo en Ajustes › Apps › YOSADRAW.");
    }

    private static boolean isImage(String mime) { return mime != null && mime.startsWith("image/"); }
    private static boolean isVideo(String mime) { return mime != null && mime.startsWith("video/"); }

    private void publish(PluginCall call) {
        io.execute(() -> {
            File part = null;
            try {
                part = partFile(call.getString("id"));
                String name = safeName(call.getString("name", "Dibujo"));
                String mime = call.getString("mime", "application/octet-stream");
                boolean image = isImage(mime);
                // Vídeos (animaciones MP4) en Películas/YOSADRAW; imágenes y GIF en Imágenes; el resto en Descargas.
                boolean video = isVideo(mime);
                String folder = video ? Environment.DIRECTORY_MOVIES : image ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_DOWNLOADS;
                JSObject r = new JSObject();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentResolver cr = getContext().getContentResolver();
                    String rel = folder + "/" + FOLDER;
                    Uri collection = video
                        ? MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                        : image
                        ? MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                        : MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                    v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH, rel);
                    v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                    Uri uri = cr.insert(collection, v);
                    if (uri == null) throw new IOException("Android no permitió crear el archivo");
                    try (OutputStream out = cr.openOutputStream(uri); InputStream in = new FileInputStream(part)) {
                        if (out == null) throw new IOException("No se pudo abrir el destino");
                        copy(in, out);
                    } catch (IOException e) {
                        cr.delete(uri, null, null);
                        throw e;
                    }
                    v.clear();
                    v.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    cr.update(uri, v, null, null);
                    // Android puede renombrar si ya existe ("Dibujo (1).png"): devolvemos el nombre real.
                    String shown = name;
                    try (android.database.Cursor c = cr.query(uri, new String[] { MediaStore.MediaColumns.DISPLAY_NAME }, null, null, null)) {
                        if (c != null && c.moveToFirst()) shown = c.getString(0);
                    }
                    r.put("uri", uri.toString());
                    r.put("path", rel + "/" + shown);
                    r.put("name", shown);
                } else {
                    File dir = new File(Environment.getExternalStoragePublicDirectory(folder), FOLDER);
                    if (!dir.exists() && !dir.mkdirs()) throw new IOException("No se pudo crear " + dir.getPath());
                    File dest = unique(dir, name);
                    try (InputStream in = new FileInputStream(part); OutputStream out = new FileOutputStream(dest)) { copy(in, out); }
                    MediaScannerConnection.scanFile(getContext(), new String[] { dest.getPath() }, new String[] { mime }, null);
                    Uri uri = androidx.core.content.FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", dest);
                    r.put("uri", uri.toString());
                    r.put("path", dest.getPath());
                    r.put("name", dest.getName());
                }
                call.resolve(r);
            } catch (Exception e) {
                call.reject("No se pudo guardar: " + e.getMessage());
            } finally {
                if (part != null) part.delete();
            }
        });
    }

    // ---------------- Almacén de proyectos (galería) ----------------
    // Claves «carpeta/nombre» con caracteres seguros, dentro de files/projects.

    private static final java.util.regex.Pattern STORE_KEY = java.util.regex.Pattern.compile("^(p|t|v|r|meta)/[A-Za-z0-9._~-]{1,140}$");

    private File storeFile(String key) throws IOException {
        if (key == null || !STORE_KEY.matcher(key).matches() || key.contains("..")) throw new IOException("Clave no válida");
        return new File(new File(getContext().getFilesDir(), "projects"), key);
    }

    @PluginMethod
    public void storeSize(PluginCall call) {
        io.execute(() -> {
            try {
                File f = storeFile(call.getString("key"));
                JSObject r = new JSObject();
                r.put("size", f.exists() ? f.length() : -1);
                call.resolve(r);
            } catch (Exception e) { call.reject(e.getMessage()); }
        });
    }

    /** Lee un trozo (base64) para no pasar archivos enteros de golpe por el puente. */
    @PluginMethod
    public void storeRead(PluginCall call) {
        io.execute(() -> {
            try {
                File f = storeFile(call.getString("key"));
                // Ojo: PluginCall.getLong() sólo acepta Long y los números del puente llegan como Integer:
                // devolvía siempre 0 y cada trozo se leía desde el principio (proyectos de más de 1,5 MB dañados
                // al abrirlos). optLong/optInt de JSONObject aceptan cualquier número.
                long offset = Math.max(0L, call.getData().optLong("offset", 0L));
                int length = Math.max(0, call.getData().optInt("length", 1 << 20));
                if (offset > f.length()) throw new IOException("Posición fuera del archivo");
                byte[] buf = new byte[(int) Math.max(0, Math.min(length, f.length() - offset))];
                try (java.io.RandomAccessFile raf = new java.io.RandomAccessFile(f, "r")) {
                    raf.seek(offset);
                    raf.readFully(buf);
                }
                JSObject r = new JSObject();
                r.put("data", Base64.encodeToString(buf, Base64.NO_WRAP));
                call.resolve(r);
            } catch (Exception e) { call.reject("No se pudo leer: " + e.getMessage()); }
        });
    }

    /** Publica en el almacén un temporal subido con beginExport/appendExport: fsync y renombrado atómico. */
    @PluginMethod
    public void storeCommit(PluginCall call) {
        io.execute(() -> {
            try {
                File part = partFile(call.getString("id"));
                File dest = storeFile(call.getString("key"));
                File dir = dest.getParentFile();
                if (dir != null && !dir.exists() && !dir.mkdirs()) throw new IOException("No se pudo crear la carpeta");
                File tmp = new File(dest.getPath() + ".tmp");
                try (InputStream in = new FileInputStream(part); FileOutputStream out = new FileOutputStream(tmp)) {
                    copy(in, out);
                    out.getFD().sync();
                }
                part.delete();
                if (!tmp.renameTo(dest)) throw new IOException("No se pudo guardar");
                call.resolve();
            } catch (Exception e) { call.reject("No se pudo guardar: " + e.getMessage()); }
        });
    }

    @PluginMethod
    public void storeDelete(PluginCall call) {
        io.execute(() -> {
            try { File f = storeFile(call.getString("key")); if (f.exists() && !f.delete()) throw new IOException("No se pudo borrar"); call.resolve(); }
            catch (Exception e) { call.reject(e.getMessage()); }
        });
    }

    @PluginMethod
    public void storeList(PluginCall call) {
        io.execute(() -> {
            try {
                String prefix = call.getString("prefix", "");
                String dirName = prefix.split("/")[0];
                if (!dirName.matches("p|t|v|r|meta")) throw new IOException("Prefijo no válido");
                File dir = new File(new File(getContext().getFilesDir(), "projects"), dirName);
                com.getcapacitor.JSArray keys = new com.getcapacitor.JSArray();
                String[] names = dir.list();
                if (names != null) for (String n : names) {
                    String k = dirName + "/" + n;
                    if (!n.endsWith(".tmp") && k.startsWith(prefix)) keys.put(k);
                }
                JSObject r = new JSObject();
                r.put("keys", keys);
                call.resolve(r);
            } catch (Exception e) { call.reject(e.getMessage()); }
        });
    }

    // ---------------- Abrir y compartir ----------------

    @PluginMethod
    public void open(PluginCall call) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(Uri.parse(call.getString("uri")), call.getString("mime", "*/*"));
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(Intent.createChooser(i, "Abrir con"));
            call.resolve();
        } catch (Exception e) { call.reject("Ninguna app puede abrir este archivo"); }
    }

    @PluginMethod
    public void share(PluginCall call) {
        try {
            Intent i = new Intent(Intent.ACTION_SEND);
            Uri uri = Uri.parse(call.getString("uri"));
            i.setType(call.getString("mime", "*/*"));
            i.putExtra(Intent.EXTRA_STREAM, uri);
            i.setClipData(android.content.ClipData.newRawUri("", uri));
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(Intent.createChooser(i, "Compartir"));
            call.resolve();
        } catch (Exception e) { call.reject("No se pudo compartir"); }
    }

    // ---------------- Utilidades ----------------

    private static String safeName(String s) {
        String n = s.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]+", "_").trim();
        return n.isEmpty() ? "Dibujo" : n;
    }

    private static File unique(File dir, String name) {
        File f = new File(dir, name);
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name, ext = dot > 0 ? name.substring(dot) : "";
        for (int n = 2; f.exists(); n++) f = new File(dir, base + " (" + n + ")" + ext);
        return f;
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[1 << 16];
        for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
        out.flush();
    }

    private static byte[] readAll(InputStream in) throws IOException {
        try (in) {
            java.io.ByteArrayOutputStream b = new java.io.ByteArrayOutputStream();
            copy(in, b);
            return b.toByteArray();
        }
    }
}
