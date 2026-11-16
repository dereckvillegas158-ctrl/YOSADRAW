## YOSADRAW 1.5.0

### Descargas
- **Windows 64 bits:** `YOSADRAW-Setup-1.5.0-x64.exe` (instalador), `YOSADRAW-1.5.0-x64-portable.exe` o `YOSADRAW-1.5.0-win.zip` (portables, sin instalar: descomprime el zip y abre `YOSADRAW.exe`). Si SmartScreen avisa: «Más información» → «Ejecutar de todas formas».
- **Android 7.0 o superior:** `YOSADRAW-1.5.0.apk`. Instálalo encima de la versión anterior (tus proyectos se conservan).

### Novedades (PC y Android)
- **Máscara de recorte en las capas** (dibujo y animación): una capa recortada sólo se ve sobre los píxeles de la capa de debajo; varias seguidas comparten la misma base. Botón ↳ en cada capa o pista, o Ctrl+Alt+G. Se ve recortada mientras pintas y se respeta al exportar (imagen, PSD, vídeo, GIF…) y en el reproductor.
- **Selector de color con cuatro modos:** Cuadro (el de siempre), **Rueda** de colores con primarios, secundarios y terciarios (pintura RYB o luz RGB) con sus luces y sombras, **Valores** (tono, saturación, brillo y RGB con números) y **Armonías** (complementario, divididos, análogos, tríada, tétrada, monocromático, luces y sombras).
- **Paletas guardables:** crear, renombrar, duplicar, ordenar, vaciar y eliminar; añadir el color actual o los recientes; quitar colores (mantener pulsado o clic derecho); importar y exportar `.gpl` (GIMP, Krita, Inkscape), JSON o listas de colores. Incluye las paletas YOSADRAW, Pieles, Grises y Pastel.
- **Efectos con apartado propio** en la barra de herramientas (PC) y en la cuadrícula de herramientas (teléfono), por categorías.
- **8 efectos nuevos:** Sombras e iluminaciones, Duotono, Solarizar, Intercambiar canales, Suavizado que conserva bordes, Paso alto, Espejo / caleidoscopio y Desplazar en mosaico (49 en total).

### Correcciones
- Las fichas de color principal y secundario del panel de color salían sin color (las tapaba un estilo de otra sección).

### Versión anterior: YOSADRAW 1.4.1

### Descargas
- **Windows 64 bits:** `YOSADRAW-Setup-1.4.1-x64.exe` (instalador), `YOSADRAW-1.4.1-x64-portable.exe` o `YOSADRAW-1.4.1-win.zip` (portables, sin instalar: descomprime el zip y abre `YOSADRAW.exe`). Si SmartScreen avisa: «Más información» → «Ejecutar de todas formas».
- **Android 7.0 o superior:** `YOSADRAW-1.4.1.apk`. Instálalo encima de la versión anterior (no hace falta desinstalar: tus proyectos se conservan).

### Correcciones
- **Android: los proyectos de más de 1,5 MB no se podían volver a abrir ni editar** después de guardarlos (salían dañados). El archivo guardado estaba bien, pero al leerlo por trozos Android ignoraba la posición y repetía el primer trozo. Corregido: los proyectos afectados vuelven a abrirse con esta versión. Además, la app comprueba cada trozo leído y nunca guarda en el historial de versiones una copia ilegible.
- **PC: WebP animado** exportaba bien en Linux pero no con el FFmpeg de Windows; ahora usa un codificador disponible en ambos.

### Versión anterior: YOSADRAW 1.4.0 — YOSADRAW ANIMATE

### Descargas
- **Windows 64 bits:** `YOSADRAW-Setup-1.4.0-x64.exe` (instalador), `YOSADRAW-1.4.0-x64-portable.exe` o `YOSADRAW-1.4.0-win.zip` (portables, sin instalar: descomprime el zip y abre `YOSADRAW.exe`). Si SmartScreen avisa: «Más información» → «Ejecutar de todas formas».
- **Android 7.0 o superior:** `YOSADRAW-1.4.0.apk`. Ábrelo en el teléfono y permite instalar apps de origen desconocido si te lo pide.

### Novedades
- **Android: animación sencilla fotograma a fotograma.** Nuevo proyecto → Animación. Los fotogramas son cuadrados con miniatura sobre el lienzo; se dibuja con los mismos pinceles y herramientas. Añadir, duplicar, mover, eliminar, papel cebolla, velocidad (FPS) y reproducir; exporta GIF y vídeo MP4 (codificador del propio teléfono) a la galería y se puede compartir.
- **PC: animación fotograma a fotograma integrada** (Nuevo proyecto → Animación): línea de tiempo con pistas, grupos, duración por fotograma, claves, copiar/pegar secuencias, marcadores, intervalo y FPS de 6 a 60. Se dibuja con los mismos pinceles y el mismo estabilizador.
- **Papel cebolla** configurable (anteriores/siguientes, opacidad, atenuación, colores, todas las pistas).
- **Audio:** MP3, WAV, OGG, FLAC y AAC con forma de onda, varias pistas, volumen, silencio/solo, recorte, desplazamiento, diálogos y sincronización labial (automática por volumen + aplicación a una pista de bocas).
- **Hoja de exposición (X-sheet)**, **interpolación de movimiento** con curvas y **guías de movimiento**, pistas de **referencia** e importación de secuencias de imágenes.
- **Reproductor en tiempo real** sincronizado con el audio, con calidad ajustable y caché que se prepara en segundo plano.
- **Exportación real con FFmpeg:** MP4 (H.264/H.265), MOV (H.264/H.265/ProRes 4444 con alfa), WebM VP9 (con alfa), GIF, APNG, WebP animado, secuencias PNG/JPEG/TIFF y hojas de sprites (PNG + JSON); 720p, 1080p, 1440p, 4K o tamaño del lienzo; FPS, calidad o bitrate, intervalo, transparencia y audio.
- Paneles redimensionables (línea de tiempo y panel derecho) y atajos de animación configurables.

### Versión anterior: YOSADRAW 1.3.0

### Descargas
- **Windows 64 bits:** `YOSADRAW-Setup-1.3.0-x64.exe` (instalador), `YOSADRAW-1.3.0-x64-portable.exe` o `YOSADRAW-1.3.0-win.zip` (portables, sin instalar: descomprime el zip y abre `YOSADRAW.exe`). Si SmartScreen avisa: «Más información» → «Ejecutar de todas formas».
- **Android 7.0 o superior:** `YOSADRAW-1.3.0.apk`. Ábrelo en el teléfono y permite instalar apps de origen desconocido si te lo pide.

### Novedades
- **Interfaz de teléfono simplificada:** barra superior mínima y un dock de siete botones (herramientas, pincel, borrador, ajustes, capas, color y más). Los ajustes de cada herramienta se abren en una hoja.
- **Imágenes de referencia:** ventanas flotantes que se mueven, se amplían, cambian de transparencia y permiten tomar colores. Se guardan con el proyecto.
- **Importar imágenes al dibujo** como capa nueva (botón, arrastrar o pegar), lista para colocar con Transformar.
- **Estabilizador mejorado en el teléfono:** suavizado extra para el dedo y el lápiz, presión simulada con el dedo y eliminación del garabato al apoyar y del gancho al soltar.

### Versiones anteriores
- **Efectos:** 41 efectos de postprocesado en GPU con vista previa en vivo (color, cambiar un tono, filtro de color, aberración cromática, desenfoque gaussiano y muchos más), sobre la capa o el lienzo completo.
- **Bloquear alfa** en las capas (botón con damero o tecla `/`).
- **Galería de proyectos** con formato nativo `.yosa`, guardado automático, recuperación e historial de versiones.
- **App de Android** adaptada a dedo y lápiz.
- **Rendimiento:** zoom, desplazamiento y guardado sin bloqueos en dibujos grandes.
