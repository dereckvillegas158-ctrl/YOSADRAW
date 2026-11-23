# YOSADRAW

Aplicación de dibujo en **TypeScript + Canvas 2D** con un motor de pinceles completo, un
estabilizador de trazos de cuatro etapas y un lienzo de alta resolución con zoom, giro y
desplazamiento fluidos. Funciona en el navegador, como **aplicación de escritorio para
Windows x64** (Electron) y como **app de Android** (APK, Capacitor) adaptada a dedo y lápiz.

## Empezar

```bash
npm install
```

```bash
npm run dev            # http://localhost:5173 (app) · /lab.html (laboratorio del estabilizador)
```

```bash
npm test               # pruebas de comportamiento (estabilizador, pinceles, lienzo, biblioteca)
```

```bash
npm run desktop:dev    # la app en Electron, con recarga en caliente
```

## Generar el .exe de Windows (64 bits)

| Comando | Resultado en `release/` | Dónde se puede generar |
|---|---|---|
| `npm run dist:win` | `YOSADRAW-Setup-1.5.0-x64.exe` (instalador) y `YOSADRAW-1.5.0-x64-portable.exe` | Windows. En Linux/macOS necesita Wine |
| `npm run dist:win:zip` | `YOSADRAW-1.5.0-win.zip` (carpeta con `YOSADRAW.exe`, sin instalar) | Cualquier sistema |
| `npm run dist:win:dir` | `release/win-unpacked/YOSADRAW.exe` | Cualquier sistema |

El workflow `.github/workflows/build-windows.yml` compila el instalador y la versión portable
en `windows-latest` al ejecutarlo a mano o al publicar una etiqueta `v*`. Los `.exe` quedan
como artefactos del run.

Notas:
- Sin certificado de firma, Windows SmartScreen avisará la primera vez ("Editor desconocido").
  Para firmar, configura `CSC_LINK` / `CSC_KEY_PASSWORD` en electron-builder.
- El icono está en `build/icon.ico` (16–256 px) y `build/icon.png`, generados del logo.
- La biblioteca de pinceles se guarda en `%APPDATA%/YOSADRAW/brushes.json`, con copia
  `brushes.json.bak`. La escritura es atómica: un corte de luz no la corrompe.

### Seguridad de la app de escritorio (`desktop/`)
- La interfaz se sirve desde un protocolo propio `app://` con una CSP estricta: sin recursos
  externos ni `eval`.
- `contextIsolation` + `sandbox`, sin Node en la interfaz. `preload.cjs` expone solo 5 funciones:
  cargar y guardar la biblioteca, exportar e importar con diálogos nativos, y la versión.
- No se puede navegar fuera de la app. Los enlaces https se abren en el navegador del sistema.
- Instancia única: abrir YOSADRAW de nuevo enfoca la ventana existente.

## App de Android (APK)

| Comando | Resultado |
|---|---|
| `npm run apk` | `android/app/build/outputs/apk/release/app-release.apk` (firmado) |
| `npm run apk:debug` | `android/app/build/outputs/apk/debug/app-debug.apk` |
| `npm run android:sync` | compila la web y la copia al proyecto `android/` |
| `npm run android:open` | abre el proyecto en Android Studio |

Requisitos para compilar: JDK 21 y el SDK de Android (plataforma 36, build-tools 35/36), con
`sdk.dir` en `android/local.properties` o `ANDROID_HOME`. Android 7.0 (API 24) o superior.

**Firma.** `android/keystore.properties` (no se sube a git) apunta a la clave `.jks`:
```
storeFile=yosadraw-release.jks
storePassword=…
keyAlias=yosadraw
keyPassword=…
```
Sin ese archivo, la release se firma con la clave de depuración. Guarda la clave: las
actualizaciones solo se instalan encima si van firmadas con la misma.

### Qué cambia en el teléfono
- **Interfaz simplificada** (1.3): arriba sólo galería, proyecto, deshacer y rehacer. Abajo (a la
  izquierda en horizontal) un dock de siete botones: **herramientas** (cuadrícula con todas, por
  categorías), **último pincel**, **borrador**, **ajustes** de la herramienta en una hoja (tocar otra
  vez el pincel o el borrador activo también la abre), **capas**, **color** y **Más** (guardar,
  exportar, efectos, importar imagen, referencias, vista y ajustes táctiles). Capas y color se abren
  en una hoja que no tapa el dock; diálogos y editor de pinceles a pantalla completa; respeta muescas
  y barra de gestos. En tableta se mantiene el diseño de escritorio con controles táctiles más grandes.
- **Deslizadores rápidos** de tamaño y opacidad junto al borde del lienzo (lado configurable).
- **Dedo**: *Automático* (dibuja hasta que se usa un lápiz; luego sólo navega y la palma no pinta),
  *Dibuja* o *Sólo navega*. Dos dedos: mover, ampliar y girar a la vez. Toque con dos dedos:
  deshacer; con tres: rehacer. Un segundo dedo que llega tarde a un trazo largo se ignora.
- **Estabilizador táctil** (en «Más»): suavizado extra para el dedo (35 % por defecto) y para el
  lápiz (10 %) que se suma al del pincel; presión simulada por la velocidad con el dedo; y limpieza
  de extremos al soltar, que quita el garabato al apoyar y el gancho al levantar (sin añadir
  retardo mientras se dibuja). En una línea con temblor simulado la desviación media bajó de 2,96 a
  0,8 px y el gancho final de 12 a 2,4 px (`src/filters/StrokeCleanup.ts`).
- **Mantener pulsado** con el dedo: cuentagotas con lupa; se arrastra para afinar.
- **Lápiz** (S Pen, lápices activos USI): presión, inclinación y vista previa del pincel al pasar por
  encima. Botón lateral: cuentagotas. Extremo borrador: borra y al levantarlo vuelve la herramienta.
- **Botón Atrás**: cierra el diálogo, menú o panel abierto; sin nada abierto, envía la app al fondo.
- **Guardado**: biblioteca y preferencias en archivos privados de la app (se guardan también al
  salir al fondo).
- **Exportar**: las imágenes van a *Imágenes/YOSADRAW* (aparecen en la galería) y los PDF a
  *Descargas/YOSADRAW*, con MediaStore (sin permisos en Android 10+). Los datos pasan al lado nativo
  por trozos de 1,5 MB, así que un TIFF de 50 MB no bloquea el puente. Al terminar: **Abrir** y
  **Compartir**.

Código: `src/yosadraw/platform/android.ts` (puente JS), `src/yosadraw/ui/Mobile.ts` y `mobile.css`
(interfaz), `android/app/src/main/java/com/yosadraw/app/YosaFilesPlugin.java` (archivos nativos).

## Arquitectura

```
src/
  core/ filters/ input/ render/   estabilizador original + StrokeRenderer + PointerInput
  yosadraw/
    doc/                          documento (lógica pura, sin interfaz)
      Document.ts                 capas, elementos, selección y comandos deshacibles + History
      items.ts                    elementos: trazo, forma, degradado, mapa de bits, borrado, grupo
      Selection.ts                selecciones combinables (rect., elipse, polígono, máscara, invertida)
      geometry.ts                 formas, simetría (matrices) y regla
      flood.ts                    relleno por inundación, dilatar y suavizar bordes
      ItemRenderer.ts             dibuja elementos con su matriz y su recorte de selección
    brush/                        motor de pinceles (sin interfaz)
      BrushPreset.ts              formato v1, valores por defecto, validación de importaciones
      schema.ts                   descripción declarativa del Brush Studio
      dynamics.ts                 presión (curva), inclinación, velocidad y afilado → tamaño/flujo
      DabGenerator.ts             puntos → sellos (Catmull-Rom centrípeta, determinista)
      ColorMixer.ts               mezcla de color por sello (óleo, acuarela húmeda, difuminador)
      StrokePainter.ts            sellos/línea lisa → píxeles con matriz afín general
      BrushStrokeSession.ts       trazo en vivo: simetría, recorte, mezcla, recomposición por rectángulo
      TipCache.ts GrainCache.ts   puntas y texturas procedurales o importadas, en caché
      BrushLibrary.ts storage.ts  biblioteca, pincel por herramienta, migración, guardado
      builtin.ts                  28 pinceles de fábrica
    engine/                       lienzo: un <canvas> por capa, vista, navegación, render progresivo
    tools/                        herramientas
      registry.ts                 definición de cada herramienta (icono, atajo, propiedades, gestos)
      handlers/                   selección, bote, degradado, formas, regla, simetría, transformar, cuentagotas
      ToolManager.ts keymap.ts    activación, ajustes, colores, atajos configurables
    ui/                           Toolbar, PropertiesBar, LayersPanel, ColorPanel, BrushStudio, diálogos
desktop/                          proceso principal y preload de Electron
```

La interfaz solo habla con el motor a través de su API y sus eventos. El documento y el
motor de pinceles no conocen la interfaz.

## Motor de pinceles

Todos los parámetros cambian el comportamiento real del pincel. `tests/brush.test.ts` lo
comprueba parámetro a parámetro. Los pinceles se usan desde las herramientas de Dibujo,
Pintura y Edición, y se editan en el **Brush Studio** (Intro o «Editar pincel…»).

| Sección (editor) | Parámetros |
|---|---|
| Forma de la punta · *Brush Tip Shape* | forma (redonda, cuadrada, rombo, triángulo, estrella, irregular, partículas, imagen importada), dureza, redondez, ángulo, volteo H/V, invertir imagen |
| Textura y grano · *Texture and Grain* | 5 texturas procedurales sin costuras o imagen importada; fija al papel o móvil con el sello; escala, profundidad, contraste, invertir |
| Espaciado · *Spacing* | espaciado en % del diámetro, variación |
| Dispersión · *Scatter* | dispersión en % del diámetro, en uno o dos ejes, sellos por paso, variación de la cantidad |
| Rotación · *Rotation* | fija, sigue la dirección del trazo, sigue el acimut del lápiz o aleatoria; ángulo base y variación |
| Dinámica de tamaño · *Size Dynamics* | tamaño, mínimo, variación, velocidad → tamaño, afilado inicial y final, grosor en la punta |
| Dinámica de opacidad · *Opacity Dynamics* | opacidad, flujo, variación del flujo, velocidad → opacidad, afilado que aclara |
| Sensibilidad a la presión · *Pressure Sensitivity* | curva editable, presión → tamaño, presión → flujo, presión simulada con ratón |
| Dinámica de inclinación · *Tilt Dynamics* | umbral, inclinación → tamaño, → flujo, → aplanar la punta |
| Renderizado del trazo · *Stroke Rendering* | motor (sellos o línea lisa vectorial), acumulación (veladura o acumulativa), 8 modos de fusión |
| Mezcla de color | color puro, húmedo (óleo/acuarela) o difuminar; recoger color, persistencia, pintura nueva |
| Estabilización | StreamLine, Stabilization, Motion Filtering y suavizado de presión e inclinación, guardados en cada pincel |

Claves del diseño:
- **Determinista.** El mismo preset, semilla y puntos producen los mismos sellos, tanto en vivo
  como al repintar. Por eso la tinta es idéntica tras hacer zoom, deshacer o rehacer.
- **Sellos en coordenadas de documento.** El espaciado y la dispersión no cambian con el zoom.
  Las puntas se generan al tamaño de pantalla necesario (hasta 1024 px). Por encima, las duras
  se trazan como vector, así que no pixelan.
- **Afilado final real.** Al soltar, los sellos se regeneran conociendo la longitud total.
- **Lo que ves es lo que queda.** El trazo en vivo se compone sobre una copia de la tinta
  previa con su opacidad, fusión y grano, recomponiendo solo el rectángulo afectado.
- **Los trazos guardan una copia congelada del preset.** Editar un pincel no cambia lo ya dibujado.

### Biblioteca
Crear, duplicar, editar en el Brush Studio, guardar o guardar como nuevo, restablecer de
fábrica, eliminar (con confirmación), importar y exportar archivos `.yosabrush` (JSON
versionado), y restaurar los pinceles de fábrica. Cada herramienta de pincel (lápiz, pluma,
óleo, borrador…) recuerda su propio pincel activo. Todo se guarda solo: en un archivo en la
app de escritorio y en `localStorage` en el navegador. Las importaciones se validan: los
campos que faltan se completan, los valores fuera de rango se corrigen y las imágenes que no
son válidas se descartan. Las bibliotecas guardadas con una versión anterior se migran solas:
reciben los pinceles y categorías nuevos sin perder los cambios del usuario.

### Cómo añadir un parámetro nuevo
1. Añádelo a `BrushPreset` y a `DEFAULT_PRESET`, con su rango en `normalizePreset`.
2. Úsalo en `dynamics.ts`, `DabGenerator.ts` o `StrokePainter.ts`.
3. Añade una línea en `schema.ts`. El editor genera el control solo.

Los presets antiguos siguen cargando: el campo nuevo toma su valor por defecto.

## Herramientas

La barra de la izquierda agrupa las herramientas por categorías. Cada una tiene un icono,
un atajo configurable y su propio panel de propiedades en la barra superior. Pulsa
**⌨ Atajos** para cambiar cualquier atajo; si eliges uno ocupado, se le quita a la otra
herramienta y se avisa. Pulsa **▦ Personalizar** para mover la barra a la derecha, mostrar
los nombres, ocultar herramientas o reordenarlas. Las categorías se pliegan haciendo clic en
su título. Todo se guarda: `settings.json` en escritorio y `localStorage` en el navegador.

| Categoría | Herramienta (atajo) | Qué hace |
|---|---|---|
| Dibujo | Lápiz (N) · Pluma (P) · Marcador (K) · Pincel (B) | Herramientas del motor de pinceles; cada una recuerda su pincel, de sus categorías de la biblioteca |
| Pintura | Aerógrafo (A) · Acuarela (Q) · Óleo (O) | Igual; acuarela húmeda y óleo **mezclan** con el color que hay en la capa |
| | Bote de pintura (G) | Relleno por inundación a resolución del documento: tolerancia, expandir (cubre el borde suavizado de las líneas), contiguo, muestra de la capa o de todas, bordes suaves, opacidad |
| | Degradado (Mayús G) | Lineal o radial, de principal a secundario o a transparente; Mayús: ángulos de 15° |
| Edición | Borrador (E) · Difuminador (S) | El borrador usa cualquier pincel; el difuminador arrastra y funde el color existente |
| Selección | Rectangular (M) · Elíptica (Mayús M) · Lazo (L) · Varita mágica (W) | Nueva/añadir/restar/intersecar (o Mayús/Alt); lazo libre o poligonal; varita con tolerancia |
| Geometría | Formas (U) | Rectángulo (con esquinas redondeadas), elipse, línea, polígono, estrella, flecha; relleno, contorno o ambos |
| | Regla (J) | Los trazos que empiezan cerca siguen la regla exactamente |
| | Simetría (Y) | Vertical, horizontal, cuadrantes, radial o mandala (2–16 copias), para pinceles y borrador |
| Transformación | Transformar (V, Ctrl T) | Mover, escalar (Mayús proporción, Alt desde el centro), girar (Mayús 15°), voltear, ±90°. Sin selección transforma la capa **sin rasterizar**; con selección, levanta lo seleccionado |
| Color | Cuentagotas (I) | Muestra de la capa o de todas, promedio 1–11 px; con cualquier pincel: Alt + clic |
| Vista | Mano (H) · Rotar vista (R) | Navegación (también Espacio, rueda, dos dedos) |

Otras acciones con atajo configurable: deshacer y rehacer, seleccionar todo (Ctrl A),
deseleccionar (Ctrl D), invertir (Ctrl Mayús I), borrar la selección (Supr), rellenar la
selección (Alt Retroceso), nueva capa (Ctrl Mayús N), duplicar (Ctrl J), combinar hacia abajo
(Ctrl E), intercambiar colores (X), colores por defecto (D), tamaño del pincel ([ ]), editar
el pincel (Intro), zoom, encajar, 100 % y enderezar la vista.

### Capas
Hasta 32 capas, con visibilidad, bloqueo, nombre (doble clic), opacidad, 11 modos de fusión,
orden, duplicar, combinar hacia abajo (conserva opacidad y fusión sin rasterizar), vaciar y
eliminar. Todo pasa por el historial. Cada capa es un `<canvas>` propio, así que el navegador
las compone con su modo de fusión exacto.

### Cómo se mantiene la calidad
Los trazos, formas y degradados son datos vectoriales con su propia matriz: transformar una
capa entera no pierde calidad. Solo son píxeles (a la resolución del documento) el relleno
del bote y una selección levantada para transformarla, porque son operaciones de píxeles.

### Cómo añadir una herramienta
1. Añade su definición en `tools/registry.ts`: id, categoría, icono, atajo y `props()`.
2. Si actúa sobre el lienzo con sus propios gestos, implementa un `ToolHandler` en
   `tools/handlers/` (`down`/`move`/`up`, `overlay` para sus guías, `key` para Intro/Esc).
3. Para modificar el documento, crea elementos con `doc.item(...)` y ejecuta un comando
   (`engine.exec(doc.cmdAddItems(...))`). Deshacer y rehacer funcionan solos.

## Rendimiento
Medido con un documento de 4096 × 3072 con 400 trazos y 1 millón de sellos, en Chromium con la CPU
4 veces más lenta (equivalente a un teléfono de gama media). «Bloqueo» = la tarea más larga del hilo
de la interfaz.

| Operación | Antes (1.1.0) | Ahora | Por qué |
|---|---|---|---|
| Zoom con dos dedos | bloqueo de 4,7 s | 0,07 s | el coste se estima por los sellos visibles (antes, por el último repintado) y lo caro se repinta por partes |
| Desplazar con dos dedos | 1,5 s | 0,1 s | se reutilizan los píxeles y sólo se pintan las franjas descubiertas; zona muerta de 4 % de zoom y 6° de giro |
| Empezar un trazo tras un zoom | 1,4 s | 0,09 s | sólo espera su capa; si es cara, el trazo se dibuja provisional y se aplica cuando la capa está lista |
| Después de cada trazo | 0,3 s | 0 | miniaturas de capa incrementales (sólo el trazo nuevo) |
| Copia de recuperación | 3,3 s | 0,06 s | ZIP en un Web Worker, sin miniatura, serialización por tandas |
| Guardar | 3,4 s | 0 | miniatura compuesta desde la pantalla o rasterizada por tandas |
| Abrir proyecto | 1,3 s | 0,8 s | descompresión en el worker |
| Arranque (JS principal) | 1,39 MB | 0,34 MB | el codificador de exportación (PSD, WebP) se carga al exportar por primera vez |
| Memoria | 144 MB | 97 MB | |

## YOSADRAW ANIMATE (animación)
Animación 2D fotograma a fotograma integrada en YOSADRAW (no es otra app): **Nuevo proyecto → Tipo:
Animación**. En PC, la versión completa (línea de tiempo, audio, hoja de exposición, FFmpeg…). En el
teléfono y en la app de Android, una versión sencilla con el mismo modelo y el mismo archivo `.yosa`
(un proyecto se puede empezar en el teléfono y seguir en el PC, y al revés).

### Teléfono y Android (versión sencilla)
- Encima del dock, una tira de **cuadrados con la miniatura** de cada fotograma y un «+» al final. Tocar
  un cuadrado va a ese fotograma; mantenerlo pulsado abre: duplicar, insertar vacío, copiar, pegar, mover
  a la izquierda/derecha y eliminar.
- Botones: reproducir/pausa, papel cebolla (mantén pulsado: ajustes), velocidad (6–60 fps), contador,
  duplicar, nuevo fotograma y ⚙ (exportar, bucle, capa nueva, fondo fijo, importar imágenes o audio).
- Se dibuja con **las mismas herramientas** del teléfono (pinceles, estabilizador táctil, borrador,
  capas, color, deshacer con dos dedos…). Cada fotograma es una columna común a todas las capas: añadir,
  duplicar o borrar mantiene las capas alineadas; una capa sin animar hace de fondo fijo.
- **Exportar** sin FFmpeg (`src/yosadraw/anim/webexport.ts`): GIF (gifenc, paleta por fotograma, bucle y
  fondo transparente) y **vídeo MP4 H.264** con el codificador del sistema (WebCodecs: en Android, el de
  hardware del teléfono) y el audio en AAC si el sistema lo codifica (mp4-muxer). Tamaños 1080, 720, 480 y
  320 (lado corto). En Android se guardan con MediaStore: GIF en *Imágenes/YOSADRAW*, MP4 en
  *Películas/YOSADRAW*, con botón **Compartir**.
- Código: `src/yosadraw/ui/anim/PhoneAnim.ts`.

### Cómo está hecho (sin sistemas duplicados)
- **Modelo** (`src/yosadraw/anim/model.ts`): una animación es un `Document` con `doc.anim`. Cada capa es
  una pista: estática (igual en todos los fotogramas, p. ej. el fondo) o animada (`layer.cels`: dibujos con
  inicio y duración). En el fotograma actual `layer.items` **es** la lista del cel visible, así que pinceles,
  estabilizador, herramientas, selección, transformar, efectos y bloqueo de alfa funcionan sin cambios.
  Pintar en un fotograma vacío crea el dibujo en el mismo paso deshacible. Deshacer un trazo lleva primero
  al fotograma donde se hizo. Las operaciones de la línea de tiempo son comandos del historial (instantáneas
  de referencias: no copian dibujos).
- **Papel cebolla**: los dibujos vecinos son capas fantasma que pinta el mismo repintado progresivo por
  lotes del lienzo; el tinte es un filtro SVG en la GPU (cambiar color u opacidad no repinta).
- **Grupos de pistas**: contenedor aislado con opacidad/visibilidad/bloqueo (el navegador compone el grupo).
- **Render** (`anim/render.ts`): caché **por dibujo** (un dibujo mantenido 6 fotogramas se rasteriza una vez;
  las capas estáticas, una sola vez), recortada a la caja del dibujo y con presupuesto de memoria (¼ de la
  RAM, 384 MB–1,5 GB, LRU). Nunca está toda la animación rasterizada en memoria.
- **Reproductor** (`anim/player.ts`): reloj del audio (AudioContext) si hay clips, así imagen y sonido no se
  separan; compone desde la caché a resolución de pantalla × calidad (completa, media, baja). Si un fotograma
  no llega a tiempo se salta y se cuenta (la velocidad no cambia). Parado, precalienta la caché en segundo
  plano; la barra verde de la regla marca los fotogramas listos para tiempo real.
- **Audio** (`anim/audio.ts`): decodificación con Chromium (MP3, WAV, OGG, FLAC, AAC/M4A, Opus) y, si falla,
  con FFmpeg. Forma de onda por picos, pistas con volumen/silencio/solo, clips con desplazamiento, recorte y
  volumen. Mezcla sin conexión (OfflineAudioContext) para exportar. Sincronización labial: diálogos de
  referencia por clip y bocas (X, A–H) por fotograma; «Generar por volumen» propone bocas según la energía
  (no reconoce fonemas) y «Aplicar bocas» expone los dibujos etiquetados de una pista siguiendo esas bocas.
- **Guardado** (`project/format.ts`): el `.yosa` guarda cels, pistas (grupo, sincronizada, referencia),
  FPS, duración, intervalo, fotograma actual, papel cebolla, marcadores, grupos, guías, notas de la hoja de
  exposición y los archivos de audio originales con sus ajustes. Un dibujo repetido se escribe una vez.
  Los proyectos de dibujo no cambian y las versiones antiguas abren una animación como su fotograma actual.
  El guardado automático y las copias de recuperación también cubren la animación.

### Línea de tiempo y paneles
- Barra: ir al principio/fin, clave o marcador anterior/siguiente, fotograma anterior/siguiente,
  reproducir (Ctrl+Intro), bucle, fotograma actual y código de tiempo, FPS (6, 8, 12, 15, 24, 30, 60),
  duración, nuevo / duplicar / eliminar fotograma, clave ↔ intermedio, alargar/acortar exposición
  (Ctrl+Alt+→/←), papel cebolla (O) y sus ajustes, interpolar, guía, hoja de exposición (Ctrl+Alt+X),
  marcador, importar audio, importar imágenes como fotogramas (clic derecho: como referencia), calidad,
  FPS reales de la reproducción, zoom y «Exportar animación» (Ctrl+Alt+E).
- Rejilla (canvas, escala a miles de fotogramas): clic = ir al fotograma y seleccionar; arrastrar un dibujo =
  moverlo (Alt = copiar, también a otra pista); arrastrar su borde derecho = duración; doble clic en un hueco =
  dibujo nuevo; Mayús+clic = rango; Ctrl+clic = añadir. En la regla: arrastrar = cabezal (con sonido),
  Mayús+arrastrar = intervalo, doble clic = marcador. Con la rejilla enfocada: Supr, Ctrl+C/X/V, Ctrl+A, K, M,
  flechas. Clips de audio: arrastrar = mover (a otra pista de audio también), bordes = recortar.
- Cabeceras: visibilidad, bloqueo, sincronizar, referencia, «Animar» (capa estática → animada), grupos
  plegables. Menús contextuales para renombrar, ordenar, duplicar, agrupar, exponer en unos/doses/treses.
- Pestaña **Animación** del panel derecho: propiedades del fotograma (duración, clave, etiqueta/boca), de la
  pista (opacidad, fusión, grupo, sincronizada, referencia), del grupo, del clip de audio (pista, inicio,
  recortes, volumen, silencio, diálogos, bocas), guías y marcadores. El panel y la línea de tiempo se
  redimensionan arrastrando su borde. Todos los atajos se cambian en «Atajos de teclado».
- **Interpolar movimiento**: a partir de un dibujo genera intermedios (copias transformadas, editables)
  desplazando, girando, escalando y desvaneciendo, con curva (lineal, acelerar, frenar, suave), en unos,
  doses…, en línea recta o siguiendo una **guía** dibujada en el lienzo (opcionalmente orientado).

### Exportación (FFmpeg)
La app de escritorio incluye FFmpeg (GPL v3, `resources/ffmpeg`, ver `LICENSE.txt` junto al ejecutable).
Cada fotograma se compone y se envía en RGBA a FFmpeg, que lo codifica al momento (con contrapresión: la
memoria no crece con la duración). La interfaz elige de una lista cerrada; la línea de órdenes la construye
el proceso principal (`desktop/video.cjs`).

| Formato | Códec | Alfa | Audio |
|---|---|---|---|
| MP4 | H.264 (libx264) o H.265 (libx265, `hvc1`) | – | AAC 192 kbit/s |
| MOV | H.264, H.265 o ProRes 4444 (alfa) / 422 HQ | ProRes | AAC o PCM |
| WebM | VP9 (`yuva420p`) | sí | Opus |
| GIF | paleta óptima de toda la animación + difuminado | 1 bit | – |
| APNG / WebP animado | apng / libwebp_anim | sí | – |
| Secuencias | PNG, JPEG, TIFF (LZW) | PNG, TIFF | – |
| Hoja de sprites | PNG + JSON (formato «hash» de TexturePacker) | sí | – |

Opciones: tamaño del lienzo, 720p, 1080p, 1440p o 4K (encajado, vertical si el lienzo lo es; pares en
vídeo), FPS de salida (si difieren del proyecto se repiten o se saltan fotogramas sin cambiar la duración),
calidad constante o bitrate, intervalo (todo, el de reproducción o personalizado), transparencia y audio
mezclado (con volúmenes, recortes y silencios). Las pistas de referencia no se exportan.
**Recuperación ante fallos:** se escribe en `nombre.part` y sólo se renombra al terminar; si la app se
cierra a mitad, al volver a abrirla borra los restos (registro en `userData/exports-in-progress.json`).
En el navegador (sin FFmpeg) sólo está la hoja de sprites.

### Pruebas
`tests/anim-model.test.ts` (fotogramas, deshacer, duplicar, insertar/quitar tiempo con pistas sincronizadas,
mover, copiar/pegar, exponer, marcadores, grupos, interpolación), `tests/project-format.test.ts`
(guardado completo de una animación) y `tests/video-ffmpeg.test.ts` (codifica de verdad los 11 formatos con
el FFmpeg incluido y comprueba códecs, alfa y audio en los archivos).

## YOSADRAW 3D Studio (editor 3D)

Proyectos 3D dentro de YOSADRAW («Nuevo proyecto → 3D»): modelado poligonal, generadores, materiales y texturas (también dibujos de YOSADRAW y pintura sobre el modelo), luces y render, escenas y plantillas, animación por keyframes, cámaras, exportación (GLB, glTF, OBJ, STL, PNG, MP4, GIF) e importación. Renderizado con Three.js, que se carga bajo demanda.

| Módulo | Archivo |
|---|---|
| Malla editable y operaciones de modelado | `src/yosadraw/studio3d/mesh.ts` |
| Generadores (escaleras, paredes, puertas, ventanas, tejados, columnas, muebles, terrenos, árboles) | `src/yosadraw/studio3d/generators.ts` |
| Modelo del proyecto (escenas, objetos, materiales, luces, cámaras, historial, validación) | `src/yosadraw/studio3d/model.ts` |
| Estado y acciones del editor | `src/yosadraw/studio3d/Studio3D.ts` |
| Visor y render (Three.js), gizmos, modo edición, bloques, pintura | `src/yosadraw/studio3d/View3D.ts` |
| Texturas procedimentales y de imagen | `src/yosadraw/studio3d/textures.ts` |
| Importar y exportar | `src/yosadraw/studio3d/io.ts` |
| Interfaz (paneles, jerarquía, línea de tiempo, asistente) | `src/yosadraw/studio3d/ui/*` |
| Modo En vivo: física (cannon-es), personajes, actores con tecla, ratón, disparadores, programa, grabación | `src/yosadraw/studio3d/live/Live.ts` |
| Cel shading y lineart de caricatura | `src/yosadraw/studio3d/toon.ts` |
| PNGTuber: audio en vivo (pistas, micrófono, hablar) | `src/yosadraw/studio3d/live/audio.ts` |
| Grabación en vivo (MP4 con audio, GIF) | `src/yosadraw/studio3d/live/recorder.ts` |
| Efectos en tiempo real (luz volumétrica, bloom, aberración, glitch, tinte) y estilos de render (squiggle, tinta, óleo, cómic, píxel, papel, TV), también por objeto; volumen (oclusión ambiental); haces de luz con sombra | `src/yosadraw/studio3d/live/fx.ts` |

## YOSADRAW MOTION (editor de vídeo)

Nuevo proyecto → **Vídeo**. El proyecto es un `.yosa` con `document.motion` (composiciones,
pistas, clips, keyframes, efectos, máscaras, marcadores y fichas de medios). Los archivos de los
medios se guardan una sola vez en el almacén de la app (`m/<id>`, más `.mp4` si se convirtió,
`.proxy` y `.fNNNNN` para secuencias) y se leen por streaming: en PC por `app://yosadraw/store/…`
con rangos HTTP, en Android desde el servidor local de la app y en el navegador como Blob.
«Exportar proyecto .yosa» los añade dentro (`media/m/…`) y al abrirlo pasan al almacén.

| Módulo | Archivo |
|---|---|
| Modelo, historial y operaciones | `src/yosadraw/motion/model.ts` |
| Keyframes, curvas y presets | `src/yosadraw/motion/keys.ts` |
| Herramientas de keyframes (suavizado automático, repetir y bucles, congelar, copiar entre capas, animación rápida, vínculos) | `src/yosadraw/motion/keytools.ts` |
| Medios (importar, streaming, proxies, miniaturas, forma de onda) | `src/yosadraw/motion/media.ts` |
| Compositor (Canvas2D + efectos WebGL2) | `src/yosadraw/motion/render.ts` |
| Audio (WebAudio en vivo y OfflineAudioContext al exportar) | `src/yosadraw/motion/audio.ts` |
| Reproductor en tiempo real | `src/yosadraw/motion/player.ts` |
| Interfaz (visor, línea de tiempo, biblioteca, inspector, curvas, exportar) | `src/yosadraw/ui/motion/*` |

En PC, FFmpeg (`desktop/video.cjs`) lee metadatos, convierte a H.264 lo que Chromium no
reproduce, crea proxies y codifica la exportación al vuelo; en Android se usa WebCodecs.
Pruebas: `tests/motion-model.test.ts` y `tests/motion-project.test.ts`.

## Capas vectoriales y carpetas

- **Capa vectorial** (`Layer.vector`): el motor convierte el pincel en línea lisa al pintar
  (`CanvasEngine.effectivePreset`): mismos tamaño, color, presión y afilado, sin texturas.
  `doc/vector.ts` tiene el toque de trazos, los nodos, la deformación con caída suave,
  suavizar y simplificar; la herramienta está en `tools/handlers/vector.ts`. El borrador
  vectorial quita los trazos enteros que toca.
- **Carpetas** (`Document.folders` y `Layer.group`; en animaciones, los grupos de pistas):
  `doc/folders.ts` compone cada carpeta aparte (opacidad y fusión propias) en pantalla,
  exportación y miniaturas, y tiene los comandos con deshacer (`Document.cmdStructure`).

## Borde del trazo y dinámica de color

`render.edge` (`normal` · `soft` · `hard`) y `render.edgeAmount` en el preset. Suave: el trazo
se compone sobre una copia desenfocada de sí mismo (en vivo, el halo se recalcula sólo
alrededor de los sellos nuevos). Duro: se recorta con la silueta vectorial de los sellos.
`color.hue/sat/light/perStroke`: colores por sello deterministas (dependen de la posición).

## Imágenes: importar y referencias
- **Importar imagen como capa** (Ctrl+Mayús+O, menú del proyecto, «Más» en el teléfono, arrastrar
  al lienzo o pegar con Ctrl+V): crea una capa nueva encima de la activa con la imagen centrada (se
  encaja si es mayor que el lienzo; se guarda hasta 2× el lienzo para poder ampliarla sin perder
  calidad) y selecciona **Transformar** para colocarla. Se deshace en un paso.
- **Imagen de referencia** (Ctrl+Alt+R, menú del proyecto, «Más», o arrastrar con Alt): ventana
  flotante que no forma parte del dibujo. Se mueve por la barra, cambia de tamaño desde la esquina,
  la imagen se amplía con dos dedos, la rueda o los botones − / + / ⤢ y se desplaza arrastrando.
  ◐ cambia la transparencia de la ventana; mantener pulsado (o Alt + clic) toma el color. Hasta 6
  por proyecto; se guardan en el `.yosa` con su posición, zoom y opacidad.

Código: `src/yosadraw/ui/Images.ts`, `src/yosadraw/ui/PhoneDock.ts`.

## Máscara de recorte
Cada capa (o pista de animación) puede **recortarse a la de debajo**: sólo se ve donde la capa base —la
primera sin recorte que tiene debajo— tiene píxeles. Varias capas seguidas con recorte comparten la misma
base; si la base está oculta, también se ocultan; una capa con recorte sin nada debajo se ve normal.
Botón ↳ en la fila de la capa o en la cabecera de la pista, o **Ctrl+Alt+G**.

- En el lienzo, la capa recortada se pinta con el mismo encuadre que su base y se recorta con su imagen;
  al cambiar la base (o el orden de capas) las recortadas se vuelven a recortar. El trazo en vivo usa la
  base como máscara, así que se ve recortado mientras se pinta.
- El mismo criterio (`src/yosadraw/doc/clip.ts`) se usa al exportar imágenes (también en PSD), en las
  miniaturas, el cuentagotas, el bote y la varita («todas las capas»), los efectos de lienzo completo y el
  render de animación (reproductor y vídeo).
- «Combinar hacia abajo» una capa recortada con su base la conserva recortada (grupo «sobre lo que ya hay»).
- Se guarda en el `.yosa`; versiones anteriores la abren como capa normal.

## Color y paletas
El panel de color conserva el color principal/secundario (X intercambia), el hexadecimal y los recientes, y
añade cuatro modos: **Cuadro** (saturación/brillo + tono, el de siempre), **Rueda** (12 colores de la rueda
de pintura RYB de Itten o de luz RGB, con anillos de luz, puro y sombra; marcas P y S para primarios y
secundarios y filas de primarios, secundarios y terciarios), **Valores** (tono, saturación, brillo, rojo,
verde y azul con deslizadores y números) y **Armonías** del color actual (cada una se puede guardar como
paleta).

**Paletas:** las incluidas (YOSADRAW, Pieles, Grises, Pastel) no se modifican: al añadirles un color se
crea una copia propia. Las propias se crean, renombran, duplican, ordenan por tono, vacían y eliminan
(menú ⋯), se les añade el color actual o los recientes y se les quitan colores (mantener pulsado o clic
derecho). Se importan `.gpl` (GIMP, Krita, Inkscape), JSON o listas de `#rrggbb` y se exportan como `.gpl`.
Se guardan con las preferencias de la app (`src/yosadraw/ui/palettes.ts`, `ColorPanel.ts`).

## Efectos
Botón ✦ **Efectos** en la barra superior, el apartado **Efectos** de la barra de herramientas (por categorías; en el teléfono, al final de la cuadrícula de herramientas), «Más» en el teléfono, o **Ctrl+Mayús+F**. 49 efectos; en la 1.5 se añadieron Sombras e iluminaciones, Duotono, Solarizar, Intercambiar canales, Suavizado que conserva bordes, Paso alto, Espejo / caleidoscopio y Desplazar en mosaico. Se elige un
efecto, se ajusta con **vista previa en vivo** sobre el lienzo y se aplica a:
- **la capa activa**: su contenido se sustituye por el resultado (un solo paso deshacible);
- **el lienzo completo**: la composición de las capas visibles se procesa en una capa nueva
  «Efecto · …» y las de origen se ocultan (no se pierde nada).

Si hay selección, sólo se aplica dentro. Si la capa tiene el **alfa bloqueado**, se conserva su
transparencia. Cada efecto tiene además **Intensidad del efecto** (mezcla con el original), botón
**Antes / después** (mantener pulsado) y **Restablecer** (doble clic en un deslizador = su valor por
defecto). Los últimos ajustes de cada efecto se recuerdan.

| Categoría | Efectos |
|---|---|
| Color | Tono/saturación/luminosidad (con «Colorear»), Cambiar un tono (rango de tono → otro tono), Brillo y contraste, Exposición y gamma, Niveles, Equilibrio de color (sombras/medios/luces), Temperatura y tinte, Intensidad (vibrance), Filtro de color (multiplicar/teñir/superponer/trama), Mapa de degradado, Blanco y negro, Sepia, Invertir, Posterizar, Umbral |
| Desenfoque | Gaussiano, Movimiento, Radial (zoom), Giratorio, Lente (bokeh), Miniatura (tilt-shift) |
| Nitidez | Máscara de enfoque, Claridad (contraste local) |
| Estilizar | Aberración cromática (radial o lineal), Resplandor (bloom), Sombra paralela, Contorno exterior, Viñeta, Semitono (CMYK o mono), Pixelar, Detectar bordes, Relieve, Pintura al óleo (Kuwahara), Glitch, Pantalla CRT |
| Distorsión | Ondas, Remolino, Abultar/pellizcar |
| Textura | Ruido/grano, Tramado (Bayer), Textura de papel |

**Cómo están hechos (y por qué van rápido)**
- Todo en la **GPU con WebGL2** (`src/yosadraw/effects/`): cada efecto es una cadena de shaders.
- Texturas en **alfa premultiplicado**: los desenfoques no dejan halos oscuros en los bordes de los trazos.
- **Desenfoque gaussiano separable con pirámide**: para radios grandes se reduce la imagen a la mitad
  las veces necesarias, así un radio de 200 px cuesta casi lo mismo que uno de 6. El bokeh y la pintura
  al óleo también trabajan a menor resolución cuando el radio es grande.
- Las medidas están en **px de documento**: la vista previa (a resolución de pantalla, con la escala de
  la vista) se ve igual que el resultado final (a resolución completa).
- Documentos grandes: **mosaicos de 2048 px** con un margen igual al alcance del efecto, alineados a
  64 px para que las reducciones caigan en la misma rejilla; probado que el resultado con y sin
  mosaicos coincide (diferencia ≤ 2/255). Fuera de la imagen todo es transparente.
- Vista previa: la imagen de origen se guarda mientras no cambian la vista ni el documento, y se usan
  dos lienzos alternos; al cerrar se libera la memoria de vídeo.

## Bloquear alfa
Botón con damero en cada capa, o tecla **/**. Con el alfa bloqueado, lo que se pinta (pinceles, bote,
degradado, formas, rellenar selección) sólo cambia el color de lo que ya hay: la transparencia no cambia
(`source-atop`, exacto con fusión normal; con otras fusiones se recorta por el alfa de la capa). Lo
pintado así queda marcado y sigue igual al repintar, al reabrir y al exportar, aunque luego se
desbloquee la capa. El borrador y «Borrar selección» no actúan en una capa con el alfa bloqueado
(cambiarían su transparencia). Se guarda en el `.yosa` y en el PSD («bloquear píxeles transparentes»).

## Proyectos y galería
Al abrir YOSADRAW aparece la **galería**: miniaturas grandes, nombre, fecha de modificación,
resolución, formato, capas e indicador **Sin guardar** (hay una copia de recuperación más nueva que
lo guardado).

- **Secciones**: Todos, Recientes (14 días), Favoritos, Carpetas y Papelera (30 días).
- **Búsqueda** por nombre, filtros por orientación y «Sin guardar», orden por modificado, nombre,
  creado o tamaño.
- **Acciones de cada proyecto** (menú ⋯, clic derecho o mantener pulsado): abrir, renombrar, duplicar,
  favorito, mover a carpeta, exportar imagen, exportar `.yosa`, historial de versiones, información
  y eliminar. En la papelera: restaurar o eliminar definitivamente; también se puede vaciar.
- **Importar**: archivos `.yosa` (siempre como proyecto nuevo) e imágenes PNG, JPEG o WebP (quedan
  como capa editable, con su transparencia).
- **Nuevo proyecto**: nombre, ancho, alto, DPI, fondo blanco o transparente, perfil de color (sRGB,
  Display P3, gris) y plantillas (móvil, cuadrado, A4, A5, carta, cómic B5, 4:5, 4K, 4:3, icono).
  Límite: 8192 px por lado y 50 MP. El fondo, el DPI y el perfil se usan al exportar.

### Guardar sin perder nada
| Mecanismo | Qué hace |
|---|---|
| **Guardar** (Ctrl+S) | Escribe el proyecto. Lo que había antes pasa al **historial de versiones** (15 por proyecto). |
| **Guardar como** (Ctrl+Mayús+S) | Crea una copia con otro nombre y sigue en la copia; el original no cambia. Los nombres nunca se repiten («Retrato (2)»). |
| **Guardado automático** | Cada 2 min con cambios y sin estar dibujando (se puede desactivar en el menú del proyecto). Guarda una versión en el historial como mucho cada 15 min, para no desplazar las de los guardados manuales. |
| **Copia de recuperación** | Unos segundos después de dejar de dibujar (más espaciada en documentos muy grandes), al cambiar de pestaña, al pasar la app a segundo plano (Android) y al cerrar. Si la app se cierra de golpe, la galería ofrece **Recuperar cambios** o **Abrir lo guardado**. |
| **Escritura segura** | Archivo temporal + fsync + renombrado (escritorio y Android) o transacción de IndexedDB (web): nunca queda un proyecto a medias. |
| **Sin sobrescribir por accidente** | Cada guardado lleva una revisión. Si otra ventana o pestaña guardó antes, se pregunta: *Guardar como copia*, *Sobrescribir* (lo otro pasa al historial) o *Cancelar*. Salir con cambios pregunta *Guardar / No guardar / Cancelar*; cerrar la ventana del escritorio también. |
| **Papelera** | Eliminar no borra: 30 días para restaurar. |
| **Índice reconstruible** | Si el índice de la galería se pierde o se daña, se rehace leyendo los proyectos. |

### Formato nativo `.yosa`
Un ZIP con `mimetype` (`application/x-yosadraw`), `project.json` (metadatos, capas con nombre,
visibilidad, bloqueo, opacidad y fusión, elementos editables, selección, pinceles congelados
deduplicados), `bin/*.bin` (sellos, colores y puntos de cada trazo), `img/*.png` (mapas de bits del
bote y de la selección levantada, máscaras de la varita y de los recortes) y `thumb.png`. Al reabrir
todo sigue editable y se ve igual píxel a píxel (comprobado). Los archivos de versiones futuras se
rechazan con un aviso en vez de abrirse mal.

### Dónde se guardan
| Versión | Ubicación |
|---|---|
| Escritorio (Windows) | `%APPDATA%/YOSADRAW/projects/` |
| Android | almacenamiento interno de la app (`files/projects`); `.yosa` exportado a *Descargas/YOSADRAW* |
| Web | IndexedDB del navegador (con almacenamiento persistente solicitado) |

Código: `src/yosadraw/project/` (`format.ts`, `store.ts`, `library.ts`, `session.ts`) y
`src/yosadraw/ui/` (`Gallery.ts`, `NewProjectDialog.ts`, `modal.ts`, `gallery.css`).

## Exportación
Botón **Exportar** (barra superior) o **Ctrl+Mayús+E**. La exportación trabaja sobre una copia
renderizada: el documento no se modifica.

| Formato | Transparencia | Calidad | DPI | Perfil ICC | Implementación |
|---|---|---|---|---|---|
| PNG | sí | sin pérdida (nivel zlib 0–9) | pHYs | iCCP | codificador propio (filtros adaptativos + fflate) |
| JPG | no (fondo elegible) | 1–100 % | JFIF | APP2 ICC_PROFILE | codificador del navegador + metadatos |
| WEBP | sí | con o sin pérdida (VP8L real) | — | ICCP (VP8X) | libwebp (@jsquash/webp, wasm) |
| BMP | sí (32 bits V5) o 24 bits | sin pérdida | sí | perfil incrustado V5 | codificador propio |
| TIFF | sí | sin compresión, LZW o Deflate (+ predictor) | sí | etiqueta 34675 | codificador propio |
| PSD | sí | sin pérdida (RLE opcional) | sí | sí | ag-psd, **conserva capas**, opacidad, modo de fusión y visibilidad |
| PDF | sí (SMask) | JPEG o sin pérdida | tamaño de página = px·72/dpi | ICCBased | escritor PDF 1.4 propio |

Opciones de la ventana: nombre, carpeta, lienzo completo o selección, ancho/alto/escala
(máx. 16384 px por lado y 100 MP), DPI (72–600 o personalizado, 300 por defecto),
compresión, transparencia o color de fondo, perfil de color (sRGB, Display P3 o escala de grises,
con conversión real de color), incrustar perfil ICC, antialiasing, combinar capas visibles o un
archivo por capa. Muestra vista previa, tamaño estimado, barra de progreso, notificación al
terminar y botón **Abrir carpeta** (app de escritorio).

- El trabajo pesado corre en un Web Worker; la interfaz no se bloquea.
- En la web se descarga el archivo (varios archivos se agrupan en un .zip).
- En escritorio solo se escribe en carpetas estándar (Imágenes, Documentos, Escritorio,
  Descargas) o en la que el usuario elija con «Cambiar…»; nunca se sobrescribe: se añade « (2)».
- Validado con decodificadores independientes (Pillow + LittleCMS, psd-tools, pypdf, poppler):
  los formatos sin pérdida son idénticos píxel a píxel.
- Limitaciones: no hay conversión a CMYK; WebP no guarda DPI; el PSD en escala de grises
  se guarda en modo RGB.

## Lienzo
- **Sin pérdida de calidad al ampliar.** Los trazos se guardan como datos (puntos ya
  estabilizados, sellos calculados y una copia congelada del preset). En cada vista se transforman a coordenadas de pantalla
  y se rasterizan a la resolución real (× devicePixelRatio). La spline Catmull-Rom centrípeta
  del renderer es invariante ante similitudes, así que la curva es idéntica a cualquier zoom,
  pero se subdivide cada 1,5 px de pantalla: nítida de 5 % a 6400 %.
- **Render eficiente.**
  - Recorte por cajas envolventes: sólo se pintan los trazos visibles.
  - Al alejar, se omiten puntos a menos de 0,6 px de pantalla del anterior.
  - Mientras dibujas no se repinta nada: cada segmento se pinta una sola vez, y el tramo
    provisional va en una capa aparte.
  - Si un repintado completo tarda más de 7 ms, durante el gesto cada capa se mueve con una
    transformación CSS (GPU) y, al parar, se repinta **por lotes de ~9 ms**, capa por capa: la
    interfaz nunca se congela. Deshacer solo repinta las capas afectadas.
  - Al alejar, los sellos casi superpuestos se funden en uno con la opacidad acumulada exacta.
- **Estabilización a escala de pantalla.** El pipeline trabaja en píxeles de pantalla, así
  que StreamLine y Stabilization se sienten igual a cualquier zoom. Al soltar, los puntos se
  convierten a coordenadas de documento.
- **Presión.** La presión y la inclinación del lápiz llegan intactas al trazo guardado.
  El panel muestra la presión en vivo.
- **Borrador** con `destination-out` y su propio pincel (cualquier preset de la biblioteca). Es un elemento más de la capa.

### Controles del lienzo

| Acción | Ratón / teclado | Táctil / lápiz |
|---|---|---|
| Dibujar · borrar | B · E | lápiz o dedo (tras usar un lápiz, el dedo sólo navega) |
| Desplazar | rueda, botón central, H, mantener Espacio | arrastrar con dos dedos |
| Zoom | Ctrl/⌘ + rueda, pellizco de trackpad, + / −, Ctrl 0 encajar, Ctrl 1 100 % | pellizcar |
| Girar | Alt + rueda, R (Mayús: pasos de 15°), botones ±15°, Mayús R enderezar | girar con dos dedos |
| Deshacer · rehacer | Ctrl Z · Ctrl Mayús Z / Ctrl Y | toque con dos · tres dedos |
| Tamaño del pincel | [ · ] | — |

## Estabilizador de trazos (detalle)

Cuatro etapas independientes, cada una con su control de 0 a 100 %:

| Etapa | Qué ataca | Técnica |
|---|---|---|
| **Motion Filtering** | Picos, golpes, sacudidas bruscas | Supresión de picos con 1 muestra de anticipación + compuerta por desviación de la predicción + limitador de tasa de presión |
| **Stabilization** | Temblor involuntario (≈ 8–12 Hz) | Filtro 1€ adaptativo a la velocidad, de 2 polos (−12 dB/oct) |
| **StreamLine** | Irregularidades de la trayectoria | Pincel remolcado (cuerda + muelle) con detección y anclaje de esquinas, y alcance del lápiz al soltar |
| **Suavizado de presión e inclinación** | Ruido del sensor del lápiz | Filtro 1€ en presión; inclinación filtrada como vector (sin saltos de acimut). No toca la posición |

Implementación original: no usa ni deriva de código de Procreate. El filtro 1€ es
un algoritmo público (Casiez, Roussel y Vogel, CHI 2012) reimplementado aquí.

### Uso del laboratorio

```bash
npm install
```

```bash
npm run dev        # laboratorio en http://localhost:5173/lab.html
```

```bash
npm test           # todas las pruebas
```

```bash
npm run artifact   # páginas únicas en dist/
```

### Arquitectura

```
src/
  core/
    types.ts         StrokePoint y el contrato StrokeStage
    BaseStage.ts     bypass exacto al 0 % e intensidad congelada por trazo
    Pipeline.ts      encadena etapas, arranque perezoso, vaciado al soltar, medición de coste
    math.ts          utilidades y "catch-up" (alcanzar al lápiz)
  filters/
    MotionFilter.ts  Motion Filtering
    OneEuro.ts       filtro 1€ 2D isótropo (1 o 2 polos) y 1D para presión
    Stabilization.ts Stabilization
    StreamLine.ts    StreamLine
    index.ts         createEngine(): orden de etapas y mapeo de los deslizadores
  render/
    StrokeRenderer.ts  Catmull-Rom centrípeta + ancho por presión + capa "viva"
  input/
    PointerInput.ts    pointerrawupdate, eventos fusionados, presión/inclinación, rechazo de palma
  playground/          zona de pruebas: paneles A/B, ruido sintético, patrones, métricas, preajustes
tests/engine.test.ts
```

### Contrato de etapa

```ts
interface StrokeStage {
  amount: number;                                   // 0..1
  begin(p: StrokePoint, out: StrokePoint[]): void;  // lápiz abajo
  push(p: StrokePoint, out: StrokePoint[]): void;   // cada muestra
  end(out: StrokePoint[]): void;                    // lápiz arriba: vaciar estado
}
```

Cada etapa puede emitir 0, 1 o N puntos por muestra, no muta su entrada y, con
`amount = 0`, es un bypass exacto (verificado en las pruebas). Para cambiar un
algoritmo basta con sustituir su clase; para añadir uno nuevo (p. ej. un suavizado
de presión), se implementa `StrokeStage` y se añade al array de `createEngine()`.

Orden: **Suavizado de presión e inclinación → Motion Filtering → Stabilization → StreamLine**. Primero se eliminan las
anomalías, para que un pico no "contamine" la estimación de velocidad del
estabilizador; después el temblor; y al final se da forma a la trayectoria.

### Cómo se cumplen los requisitos del estabilizador

- **Latencia mínima.** Las muestras se procesan en el propio manejador de eventos
  (`pointerrawupdate` donde existe, con `getCoalescedEvents()` para no perder las
  muestras a 240 Hz). Los segmentos completos de la spline se fijan en el lienzo al
  instante; el último tramo provisional se pinta en una capa `live` por fotograma.
  Contextos `desynchronized`. Coste medido: ~1–7 µs por muestra con las tres
  etapas activas (presupuesto a 240 Hz: 4 166 µs).
- **Presión.** Presión e inclinación reales del lápiz atraviesan todo el pipeline;
  Stabilization filtra el ruido del sensor y Motion Filtering limita saltos bruscos.
- **Conservar velocidad y naturalidad.** El corte del estabilizador sube con la
  velocidad: a 150 px/s y 100 % el temblor baja de 1,46 a 0,19 px RMS, y a
  2 500 px/s el retraso es ~6 ms.
- **Esquinas no redondeadas.** StreamLine detecta vértices (giro > 50° en una
  ventana proporcional al radio) y obliga a la tinta a pasar por ellos; las
  ondulaciones pequeñas siguen suavizándose. La spline centrípeta evita
  sobreoscilaciones en esos vértices.
- **Final del trazo.** Las tres etapas "alcanzan" la punta del lápiz al soltar, así
  el trazo termina donde el usuario levantó el lápiz.

### Laboratorio (lab.html)

- **A/B**: dos lienzos con ajustes independientes que reciben exactamente la misma
  entrada; dibujar en cualquiera alimenta a ambos.
- **Reprocesado instantáneo**: al mover un control, lo dibujado se vuelve a procesar.
- **Reproducir**: repite los trazos grabados con su temporización original.
- **Perturbar la entrada**: temblor sintético (8–12 Hz + ruido) y picos, deterministas,
  para probar con ratón.
- **Patrones**: esquinas y zigzag rápido, espiral lenta, bucles de caligrafía, rayado rápido.
- **Métricas** por lienzo: coste en µs por muestra, retraso medio tinta–lápiz y giro
  acumulado por 100 px (menor = más suave) frente al trazo crudo.
- **Trazo crudo**: superpone en rojo la entrada sin procesar.

---
