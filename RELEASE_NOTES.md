## YOSADRAW 1.22.1

### Descargas
- **Windows 64 bits:** `YOSADRAW-Setup-1.22.1-x64.exe` (instalador), `YOSADRAW-1.22.1-x64-portable.exe` o `YOSADRAW-1.22.1-win.zip` (portables, sin instalar: descomprime el zip y abre `YOSADRAW.exe`). Si SmartScreen avisa: «Más información» → «Ejecutar de todas formas».
- **Android 7.0 o superior:** `YOSADRAW-1.22.1.apk`. Instálalo encima de la versión anterior (tus proyectos se conservan).

### Sin tirones al grabar en vivo con una cámara de la escena (3D Studio)
- **Los sombreadores se preparan al entrar en vivo**, también los de lo que todavía no se ve: lo que queda fuera del encuadre de la cámara, el fogonazo, los casquillos y sus sombras. Antes se preparaban la primera vez que aparecían en pantalla y ese fotograma se quedaba congelado (el primer disparo llegaba a tardar más de un segundo; ahora, unos milisegundos).
- **Las luces dinámicas** (fogonazo, chispas, explosiones) ya no se apagan y encienden: cambiar el número de luces obligaba a rehacer los sombreadores de todos los materiales en cada disparo.
- **La calidad adaptativa ya no sube y baja sin parar.** Cada cambio rehacía los lienzos internos de los efectos (un tirón cada pocos segundos). Ahora sólo sube tras varios segundos holgados, nunca justo después de bajar, y **mientras se graba sólo puede bajar**. Los rayos de luz guardan su sombreador para cada calidad (cambiar ya no lo recompila).
- **La niebla y el fondo se reutilizan** de un fotograma a otro: con una cámara animada con keyframes, se creaban nuevos en cada fotograma y Three revisaba el sombreador de cada material en cada uno.

### Versión anterior: YOSADRAW 1.22.0

### Descargas
- **Windows 64 bits:** `YOSADRAW-Setup-1.22.0-x64.exe` (instalador), `YOSADRAW-1.22.0-x64-portable.exe` o `YOSADRAW-1.22.0-win.zip` (portables, sin instalar: descomprime el zip y abre `YOSADRAW.exe`). Si SmartScreen avisa: «Más información» → «Ejecutar de todas formas».
- **Android 7.0 o superior:** `YOSADRAW-1.22.0.apk`. Instálalo encima de la versión anterior (tus proyectos se conservan).

### Armas de la vida real en 3D Studio
**Añadir → Armas** ahora trae modelos de armas reales, hechos con sus medidas y su silueta reales: cada pieza es su contorno extruido con bordes biselados (guardamontes con su hueco, cargadores curvos, empuñaduras inclinadas, culatas y guardamanos de madera), con cañones, bocachas y miras torneados.
- **Glock 17** (9 mm, 17 balas): corredera cuadrada con estrías, armazón de polímero con textura de agarre, empuñadura a 22°.
- **Colt M1911** (.45, 7 balas): martillo a la vista, seguro de empuñadura y cachas de madera.
- **AK-47** (7,62 × 39, 30 balas): culata y guardamanos de madera, tubo de gases, cargador muy curvo, palanca selectora.
- **M4A1** (5,56, 30 balas): culata telescópica, raíl superior, mira delantera A2, guardamanos estriado, tapa del expulsor y asistente de cierre.
- **MP5** (9 mm, 30 balas): tubo de carga sobre el cañón, mira de túnel, alza de tambor y cargador curvo.
- **Remington 870** (calibre 12): guardamanos de bombeo estriado, culata de madera y depósito tubular.
- **Colt Python** (.357, 6 balas): cañón de 6" con banda ventilada y faldón, tambor estriado, martillo.
- **M24** (.308, 5 balas): fusil de cerrojo de francotirador con culata sintética y visor.

Todas conservan sus piezas móviles y su mecánica en vivo (disparo con fogonazo y casquillos, corredera o cerrojo, retroceso, recarga, cargador con el ratón, inspección) y se animan con keyframes por pieza.

### Modelos importados con todas sus texturas (calidad de videojuego)
- **Ya no salen sin textura.** Ahora se importan también los **.zip** tal cual (como los de Sketchfab: modelo, .bin y carpeta de texturas), las texturas se encuentran por su nombre aunque estén en otra carpeta o con otra extensión (el FBX pide «.tga» y la carpeta trae «.png»), y se leen las **.tga**.
- **Mapas PBR completos:** además del color se importan el **relieve (normales)**, la **rugosidad**, el **metal**, la **oclusión** y la **emisión**, como en Escape from Tarkov o Call of Duty. Antes se perdían y los modelos se veían planos.
- **Orientación correcta** de las texturas de glTF/GLB (antes podían salir invertidas).
- **Poner texturas a mano:** si un modelo no trae texturas, al importarlo aparece «Añadir texturas…»; también en **Objeto → Texturas del modelo**. Elige varias imágenes a la vez (BaseColor, Normal, Roughness, Metallic, AO, ORM, metalRoughness, Emissive…) y cada una va sola a su material y a su mapa según el nombre. **Lo que el modelo ya trae se respeta.**
- En **Material → Mapas PBR** cada mapa tiene su «Imagen…» y «Quitar», y la fuerza del relieve.
