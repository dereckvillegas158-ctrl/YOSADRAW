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
| `npm run dist:win` | `YOSADRAW-Setup-1.0.0-x64.exe` (instalador) y `YOSADRAW-1.0.0-x64-portable.exe` | Windows. En Linux/macOS necesita Wine |
| `npm run dist:win:zip` | `YOSADRAW-1.0.0-win.zip` (carpeta con `YOSADRAW.exe`, sin instalar) | Cualquier sistema |
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
- **Interfaz**: barra superior compacta (deshacer, rehacer, zoom, exportar, color, «Más» y paneles);
  herramientas abajo en vertical y a la izquierda en horizontal; capas, color y pinceles en una
  hoja inferior que se cierra deslizando; diálogos y editor de pinceles a pantalla completa;
  respeta muescas y barra de gestos. En tableta se mantiene el diseño de escritorio con controles
  táctiles más grandes.
- **Deslizadores rápidos** de tamaño y opacidad junto al borde del lienzo (lado configurable).
- **Dedo**: *Automático* (dibuja hasta que se usa un lápiz; luego sólo navega y la palma no pinta),
  *Dibuja* o *Sólo navega*. Dos dedos: mover, ampliar y girar a la vez. Toque con dos dedos:
  deshacer; con tres: rehacer. Un segundo dedo que llega tarde a un trazo largo se ignora.
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
