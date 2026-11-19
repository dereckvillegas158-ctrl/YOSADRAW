## YOSADRAW 1.7.0

### Descargas
- **Windows 64 bits:** `YOSADRAW-Setup-1.7.0-x64.exe` (instalador), `YOSADRAW-1.7.0-x64-portable.exe` o `YOSADRAW-1.7.0-win.zip` (portables, sin instalar: descomprime el zip y abre `YOSADRAW.exe`). Si SmartScreen avisa: «Más información» → «Ejecutar de todas formas».
- **Android 7.0 o superior:** `YOSADRAW-1.7.0.apk`. Instálalo encima de la versión anterior (tus proyectos se conservan).

### Dibujo (PC y Android)
- **Capas vectoriales** (botón de la curva en Capas): lo que dibujas en ellas se guarda como línea editable. Herramienta **Editar vector** (Mayús+V): toca un trazo, arrastra sus nodos (los vecinos siguen con suavidad según «Influencia») o el trazo entero; cambia grosor, opacidad y color; suaviza, simplifica, duplica o elimina. En una capa vectorial el **borrador quita trazos enteros**.
- **Carpetas de capas** (botón de la carpeta): agrupan capas con su propia visibilidad, bloqueo, opacidad y modo de fusión (las capas se mezclan entre sí y el resultado entra con los de la carpeta). Subir y bajar una capa la mete o la saca de la carpeta; menú «⋯» para meter, sacar, desagrupar o eliminar. Se guardan, se exportan (PNG, JPEG, PDF…; en PSD, capas «Carpeta / Capa») y se ven igual en YOSADRAW MOTION.
- **Pinceles más fáciles y personalizables:** sección **Básico** en el Brush Studio con lo esencial y **estilos rápidos** (Lápiz, Tinta, Rotulador, Pincel suave, Aerógrafo, Acuarela, Óleo, Carboncillo, Línea lisa, Confeti); nueva **dinámica de color** (variación de tono, saturación y luminosidad por sello o por trazo).
- **Borde del trazo (antialiasing):** *Suave* — los bordes se suavizan; *Duro* — contorno limpio y nítido como un vector y, por dentro, los sellos con su textura. Se ve igual al pintar que al soltar, y se guarda con cada trazo.
- 3 pinceles nuevos: Tinta limpia (borde duro), Rotulador suave y Confeti de color.

### Vídeo — YOSADRAW MOTION
- **Keyframes: copiar y pegar donde sea.** Elige rombos en la línea de tiempo (Mayús suma), arrástralos juntos, cópialos (Ctrl+C) y pégalos en el cabezal de cualquier clip (Ctrl+V); clic derecho en un rombo o en una propiedad para copiar/pegar sólo esa propiedad o en otra del mismo tipo; borrar y cambiar la curva de varios a la vez.
- **Explorador de Filtros, Transiciones, Efectos y Animaciones** (pestaña Efectos, o botón Efectos en el teléfono) con miniaturas hechas por el propio motor; transiciones y animaciones se reproducen al pasar el ratón.
- **20 filtros** (Cine, Vintage, Noir, Cálido, Frío, Vívido, VHS, Cómic, Duotono…), **11 transiciones nuevas** (zoom desde cerca, giro, pop, balanceo, barridos ↑↓, iris, persianas, destello, glitch) y **45 animaciones** de entrada, salida y bucle (rebotar, caer, elástico, latigazo, latido, gelatina, tadá, órbita…).

### Rendimiento y correcciones
- El editor de vídeo y los codificadores GIF/MP4 del teléfono se cargan sólo cuando se usan: el código que se carga al abrir la app baja de 285 KB a 211 KB comprimidos (arranque más rápido, sobre todo en Android).
- El borde suave se calcula sólo alrededor de lo nuevo al pintar (antes, todo el trazo en cada fotograma: hasta 66 ms en trazos enormes).
- Escritorio: la detección de medios que faltan no funcionaba con la carpeta de medios.
- Biblioteca de medios: el buscador salía encogido.

### Versión anterior: YOSADRAW 1.6.0 — YOSADRAW MOTION

### Descargas
- **Windows 64 bits:** `YOSADRAW-Setup-1.6.0-x64.exe` (instalador), `YOSADRAW-1.6.0-x64-portable.exe` o `YOSADRAW-1.6.0-win.zip` (portables, sin instalar: descomprime el zip y abre `YOSADRAW.exe`). Si SmartScreen avisa: «Más información» → «Ejecutar de todas formas».
- **Android 7.0 o superior:** `YOSADRAW-1.6.0.apk`. Instálalo encima de la versión anterior (tus proyectos se conservan).

### Novedad: editor de vídeo y motion graphics (PC y Android)
Nuevo proyecto → **Vídeo**. En PC: herramientas a la izquierda, biblioteca e historial, visor central, propiedades a la derecha y línea de tiempo multipista abajo (todos los paneles se redimensionan). En teléfono y Android, la misma edición con una interfaz simplificada: visor, línea de tiempo compacta y una barra de acciones (Medios, Texto, Formas, Editar, Efectos, Animar, Dividir, Borrar).

- **Importar:** MP4, MOV, MKV, WebM, AVI (en PC, lo que el sistema no reproduce se convierte con FFmpeg), GIF, PNG, JPG, WebP, SVG, secuencias de imágenes, WAV, MP3, OGG, FLAC, AAC, fuentes (TTF/OTF/WOFF) y LUT `.cube`. Biblioteca con miniaturas, forma de onda, metadatos, búsqueda, filtros y carpetas; se arrastra a la línea de tiempo o al visor. Los vídeos se leen por streaming (no se cargan enteros en memoria).
- **Línea de tiempo multipista:** pistas de vídeo/imagen/texto/formas y de audio; mover (también entre pistas), recortar por los bordes, dividir, cuchilla, duplicar, copiar/cortar/pegar, agrupar, precomponer, ocultar, bloquear, silenciar y solo; velocidad, invertir, congelar fotograma, bucle, separar el audio; edición en cadena (ripple), ajuste magnético a bordes, cabezal y marcadores; intervalo de trabajo; selección múltiple con recuadro; zoom y desplazamiento.
- **Keyframes** en posición, escala, rotación, opacidad, anclaje, inclinación, volumen, panorámica, colores, máscaras y parámetros de efectos; curvas lineal, suave, acelerar, frenar, Bézier editable, rebasar, rebote, elástico y mantener; **editor de curvas**; presets de movimiento (entrada, salida, énfasis) y presets propios.
- **Composición:** transformaciones en el visor (mover, escalar, girar, anclaje), modos de fusión, recorte, máscaras rectangulares y elípticas animables (sumar, restar, invertir, suavizado), composiciones anidadas, **cámara 2D** con paralaje por pista y desenfoque de movimiento al exportar.
- **Texto y gráficos:** títulos y subtítulos con fuentes propias, contorno, sombra, degradado, caja de fondo, texto en arco, espaciado y animaciones (máquina de escribir, letras, palabras); formas vectoriales (rectángulo, elipse, polígono, estrella, línea, flecha) con relleno, degradado, trazo, discontinuo y trazado progresivo; sólidos.
- **Efectos** (los 49 de YOSADRAW más croma, curvas y LUT 3D), apilables, animables y no destructivos, con presets; **transiciones** de entrada y salida (fundido, deslizar, zoom, barrido, desenfoque).
- **Audio:** varias pistas, forma de onda, volumen y panorámica animables, fundidos, recorte, desplazamiento, bucle y vista previa sincronizada (el reloj es el audio).
- **Rendimiento:** decodificación por hardware del sistema, **proxies** de 540p en PC (la vista previa usa el proxy; la exportación, el original), calidad de vista previa automática o fija, caché de fotogramas.
- **Exportar:** en PC con FFmpeg — MP4 (H.264/H.265), MOV (H.264/H.265/ProRes 4444 con alfa), WebM VP9 (con alfa), GIF, WebP animado y secuencia PNG; en Android — MP4 H.264 + AAC con el codificador del teléfono, GIF y secuencia PNG. Resolución de la composición, 720p, 1080p, 1440p, 4K o mitad; FPS de la composición, 23,976–60 o personalizados; calidad constante o bitrate; intervalo; transparencia; mezcla de audio; barra de progreso con tiempo restante y cancelar.
- **Proyecto:** se guarda en el `.yosa` de siempre (guardado automático, recuperación tras un cierre, versiones, «Guardar como»). Aviso de archivos que faltan con «volver a vincular». «Exportar proyecto .yosa» incluye todos los medios para abrirlo en otro equipo.
- **Integración con YOSADRAW:** cualquier dibujo o animación de la galería (con transparencia, todas las capas o una) se usa como clip; desde el dibujo, menú del proyecto → **Enviar a YOSADRAW MOTION**. El original no se toca: si lo vuelves a editar, la biblioteca ofrece «actualizar».
- **Atajos configurables** (botón de teclado), copiar y pegar atributos, panel de historial.

### Aún no incluido (honesto)
- Seguimiento de movimiento (motion tracking), estabilización de vídeo, curvas de velocidad variables, deformación de malla/perspectiva y texto sobre trazados libres (sí hay texto en arco). La rotoscopia se hace con máscaras animadas por keyframes.
- En Android la exportación arma el MP4 en memoria: para vídeos muy largos, exporta por partes con el intervalo. El audio de cada clip se decodifica completo para mezclarlo.

### Versión anterior: YOSADRAW 1.5.0

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
