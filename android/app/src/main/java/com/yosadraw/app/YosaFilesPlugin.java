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

    private void publish(PluginCall call) {
        io.execute(() -> {
            File part = null;
            try {
                part = partFile(call.getString("id"));
                String name = safeName(call.getString("name", "Dibujo"));
                String mime = call.getString("mime", "application/octet-stream");
                boolean image = isImage(mime);
                JSObject r = new JSObject();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentResolver cr = getContext().getContentResolver();
                    String rel = (image ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_DOWNLOADS) + "/" + FOLDER;
                    Uri collection = image
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
                    File dir = new File(Environment.getExternalStoragePublicDirectory(image ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_DOWNLOADS), FOLDER);
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
