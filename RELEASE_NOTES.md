## YOSADRAW 1.18.0

### Descargas
- **Windows 64 bits:** `YOSADRAW-Setup-1.18.0-x64.exe` (instalador), `YOSADRAW-1.18.0-x64-portable.exe` o `YOSADRAW-1.18.0-win.zip` (portables, sin instalar: descomprime el zip y abre `YOSADRAW.exe`). Si SmartScreen avisa: «Más información» → «Ejecutar de todas formas».
- **Android 7.0 o superior:** `YOSADRAW-1.18.0.apk`. Instálalo encima de la versión anterior (tus proyectos se conservan).

### Nuevo: módulo PNGTuber (2D)
El PNGTuber ya tiene su propio módulo: **Nuevo proyecto → Tipo: PNGTuber**. Todo en 2D: tu personaje sobre una **pantalla verde** o un **escenario dibujado**, listo para emitir o grabar.
- **Fondo:** pantalla verde (para recortarla en OBS con «Chroma Key»), azul, magenta, escenario oscuro, cualquier color, transparente (para renders) o un **escenario dibujado**: un dibujo de YOSADRAW o una imagen que cubre todo el encuadre y no se mueve.
- **Vista plana de frente** y **colores originales del dibujo** (sin luces ni ajustes de tono: el verde y el personaje salen exactos). Si quieres, se pueden activar las luces y sombras.
- **Panel PNGTuber** con todo a mano: personajes (por capas o desde un PNG), fondo, aspecto, audio y micrófono con medidor, y **▶ Empezar**.
- Todo lo del PNGTuber sigue igual: boca y parpadeo, expresiones con teclas, rebote y squash al hablar, partes que se balancean, agarrar y sacudir con el ratón (ahora siempre en el plano de la pantalla), disparadores, programa, efectos y grabación MP4 con audio y GIF.
- **Para OBS:** pulsa H en vivo para ocultar la interfaz y captura la ventana; con la pantalla verde se recorta el fondo.
- En la galería los proyectos aparecen como «PNGTuber · N personajes».
- Las partes de un personaje por capas quedan un poco más separadas para que siempre se vean delante del cuerpo.

### Versión anterior: YOSADRAW 1.17.0

### Descargas
- **Windows 64 bits:** `YOSADRAW-Setup-1.17.0-x64.exe` (instalador), `YOSADRAW-1.17.0-x64-portable.exe` o `YOSADRAW-1.17.0-win.zip` (portables, sin instalar: descomprime el zip y abre `YOSADRAW.exe`). Si SmartScreen avisa: «Más información» → «Ejecutar de todas formas».
- **Android 7.0 o superior:** `YOSADRAW-1.17.0.apk`. Instálalo encima de la versión anterior (tus proyectos se conservan).

### Nuevo: PNGTuber en 3D Studio
Personajes 2D que hablan, reaccionan y viven dentro de la escena 3D, usando lo que ya tiene YOSADRAW: dibujo, poses y transiciones, física, disparadores, programa, efectos y grabación. Todo en **Añadir → PNGTuber** y en el modo **En vivo**.
- **Personajes:** un PNG con transparencia (**Personaje desde un PNG…**) o un dibujo de YOSADRAW **por capas** (**Personaje por capas (dibujo)…**): la capa de abajo es el cuerpo y las demás son partes que **se balancean** al moverlo (pelo, orejas, accesorios), con su punto de giro ajustable.
- **Hablar y parpadear:** imágenes de **boca abierta** y **ojos cerrados** (también por cada expresión), parpadeo automático, y al hablar **rebote**, **squash and stretch** y brillo ajustables. Las imágenes originales no se modifican.
- **Expresiones y estados:** las poses (con tecla y transición) son las expresiones; los disparadores también pueden cambiarlas (**Cambiar de expresión**).
- **Audio:** importa audios (MP3, WAV, OGG…) que suenan al empezar o con un disparador, o usa el **micrófono** (tu voz mueve al personaje). Umbral para hablar, tiempo que se mantiene la boca abierta y medidor de nivel. Nuevos sucesos para los disparadores y el programa: **al empezar a hablar**, **al callarse** y **sonido fuerte**; en el programa, `audio.level`, `audio.talking`, `audio.play()`, `audio.mic()` y `on('talk', …)`. Con varios actores, sólo habla el que controlas.
- **En la escena 3D:** colócalos, gíralos y escálalos donde quieras; agárralos y sacúdelos con el ratón (se inclinan de frente, con gelatina), con física, personajes que caminan, luces (incluida la volumétrica), sombras, cel shading, glitch, aberración y cambios de color en vivo. **Escenario PNGTuber** prepara cámara de frente, luz de escenario, luz de contorno y efectos suaves.
- **Grabar:** el vídeo en vivo ahora lleva **el audio** (lo que suena y el micrófono) y se puede grabar también como **GIF animado** (640 px, hasta 40 s), además de MP4 en alta calidad, conservando efectos y físicas.
- **Rendimiento:** el audio sólo se analiza si la escena lo usa, el nivel se calcula una vez por fotograma, y los deslizadores de efectos de la barra En vivo quedan plegados (botón **✨ Efectos**) para no tapar la escena.
- Android pide permiso para el micrófono la primera vez que se usa.

### Corrección
- **Dibujo: bajar la opacidad de una capa ya no la hace desaparecer.** Con 4 o más capas, al soltar el deslizador de opacidad la capa elegida dejaba de verse hasta que se ocultaba algo. Ahora se ve con su nueva opacidad al momento (también al cambiar la fusión u otras propiedades de la capa).

### Versión anterior: YOSADRAW 1.16.0

### Descargas
- **Windows 64 bits:** `YOSADRAW-Setup-1.16.0-x64.exe` (instalador), `YOSADRAW-1.16.0-x64-portable.exe` o `YOSADRAW-1.16.0-win.zip` (portables, sin instalar: descomprime el zip y abre `YOSADRAW.exe`). Si SmartScreen avisa: «Más información» → «Ejecutar de todas formas».
- **Android 7.0 o superior:** `YOSADRAW-1.16.0.apk`. Instálalo encima de la versión anterior (tus proyectos se conservan).

### Nuevo en 3D Studio: dibujo animado
- **Cel shading** para toda la escena (Vivo → «Dibujo animado») o sólo para un objeto (Objeto → «Dibujo animado del objeto»): número de tonos, suavidad del borde, sombra que **reacciona al color del ambiente** o con **un color propio**, y brillo de borde con su color. Estilos listos: Caricatura y Anime. Se ve en vivo, en la vista previa de efectos y en los renders (imagen, MP4 y GIF). Amplía la opción «Estilizado» de los materiales sin reemplazarla.
- **Lineart de caricatura:** contorno con grosor y color, para toda la escena o por objeto. En las figuras es un contorno de grosor constante; en los dibujos sigue su silueta.
- **Poses de los dibujos con transiciones en vivo:** a un dibujo en 3D se le pueden añadir otros dibujos o imágenes como poses, cada una con su tecla (y una tecla para el original y otra para «siguiente pose»). En vivo, al pulsar la tecla el dibujo cambia con una transición, sin keyframes: **squash and stretch** (aplastar y estirar), volteo, giro, pop, fundido, salto, sacudida o corte, con duración ajustable. También desde el programa: `obj("Gato").pose("Feliz")`. Las poses se guardan en el proyecto.
- **Grabación de vídeo en vivo arreglada y con más calidad:** ocultar o mostrar la interfaz mientras se graba ya no estropea el vídeo (se graba a un tamaño fijo, independiente de la ventana). Se elige la calidad (720p, 1080p, 1440p o el tamaño de la pantalla); mientras se graba, la escena se dibuja a la resolución del vídeo y con más bits por segundo, así que sale más nítido. El primer fotograma ya no sale negro.
- **Grabar con la interfaz oculta:** botón **«⏺ Grabar sin interfaz»** (oculta todo y empieza a grabar) y, con la interfaz oculta, un botón discreto para grabar o parar con el tiempo de grabación. **F9** empieza o para la grabación en cualquier momento; Esc también la termina y la guarda.
- **Optimización del modo En vivo:** los objetos quietos o dormidos ya no se recalculan en cada fotograma y el bucle de física y de dibujo reutiliza sus objetos de trabajo (menos trabajo y menos tirones del recolector de memoria).

### Versión anterior: YOSADRAW 1.15.2

### Descargas
- **Windows 64 bits:** `YOSADRAW-Setup-1.15.2-x64.exe` (instalador), `YOSADRAW-1.15.2-x64-portable.exe` o `YOSADRAW-1.15.2-win.zip` (portables, sin instalar: descomprime el zip y abre `YOSADRAW.exe`). Si SmartScreen avisa: «Más información» → «Ejecutar de todas formas».
- **Android 7.0 o superior:** `YOSADRAW-1.15.2.apk`. Instálalo encima de la versión anterior (tus proyectos se conservan).

### «Siempre de pie» y la inclinación de frente, juntos
- Un personaje con **Siempre de pie (no vuelca)** ahora también se inclina de frente al arrastrarlo con el ratón (desde el punto donde lo agarras, sin dejar de mirar al frente). Al soltarlo se balancea y vuelve a quedar de pie: nunca se cae ni vuelca, y sigue caminando, saltando y respondiendo a sus teclas de actor como siempre.

### Versión anterior: YOSADRAW 1.15.1

### Descargas
- **Windows 64 bits:** `YOSADRAW-Setup-1.15.1-x64.exe` (instalador), `YOSADRAW-1.15.1-x64-portable.exe` o `YOSADRAW-1.15.1-win.zip` (portables, sin instalar: descomprime el zip y abre `YOSADRAW.exe`). Si SmartScreen avisa: «Más información» → «Ejecutar de todas formas».
- **Android 7.0 o superior:** `YOSADRAW-1.15.1.apk`. Instálalo encima de la versión anterior (tus proyectos se conservan).

### Arrastre más vivo en el modo En vivo
- **Los dibujos se inclinan de frente al arrastrarlos:** al mover el ratón hacia un lado, el dibujo gira en su propio plano (como una hoja agarrada por arriba: la parte de abajo se queda atrás), sin dejar de mirar al frente y sin necesitar «mirar a la cámara». Al parar oscila un poco y al soltarlo vuelve a ponerse derecho. Cuanto más **Balanceo al arrastrar**, más se inclina.
- Nueva opción en Objeto → Física y control: **Al arrastrarlo con el ratón**: «Se inclina de frente» (por defecto en los dibujos) o «Gira libre en 3D» (por defecto en los demás objetos, como hasta ahora).

### Versión anterior: YOSADRAW 1.15.0

### Descargas
- **Windows 64 bits:** `YOSADRAW-Setup-1.15.0-x64.exe` (instalador), `YOSADRAW-1.15.0-x64-portable.exe` o `YOSADRAW-1.15.0-win.zip` (portables, sin instalar: descomprime el zip y abre `YOSADRAW.exe`). Si SmartScreen avisa: «Más información» → «Ejecutar de todas formas».
- **Android 7.0 o superior:** `YOSADRAW-1.15.0.apk`. Instálalo encima de la versión anterior (tus proyectos se conservan).

### Nuevo en 3D Studio
- **Estilo propio por objeto (shaders):** cualquier objeto o dibujo puede tener su propio squiggle, tinta (con su color), óleo, posterizado, semitono, píxel art o líneas de TV, sin cambiar el resto de la escena (se suma al estilo de la escena). Estilos listos: Squiggle vision, Cómic, Óleo, Píxel art y Holograma. Panel **Objeto → Estilo del objeto (shaders)**; se ve en los modos Materiales y Render (el squiggle tiembla también al editar), en vivo y en los renders de imagen, MP4 y GIF.
- **Volumen en los renders:** nuevo efecto **Volumen (oclusión ambiental)**: sombras suaves en rincones, uniones y bajo los objetos, que dan sensación de volumen. Y los dibujos en 3D pueden tener **grosor** (Objeto → «Grosor del dibujo»): se ven como recortes con cuerpo desde cualquier ángulo.
- **Actores en el modo En vivo:** a cada personaje se le puede poner una o más teclas (Objeto → Física y control → «Actor: tecla(s)»). En vivo, al pulsar su tecla pasas a controlarlo: clic en la escena para mandarlo allí, WASD o flechas para caminar, Espacio para saltar; los demás actores se quedan quietos o vuelven a su sitio (se elige por actor). Barra de actores en vivo para elegirlos con el ratón, y un aro marca al que controlas.
- **Opción del clic en vivo:** con un actor elegido, el clic sólo mueve al actor y no agarra objetos (se puede desactivar en Vivo → Física de la escena).
- **En vivo ya no se elige ni se mueve nada del proyecto** al hacer clic: sin contornos naranjas, sin gizmos.
- **Ocultar la interfaz en vivo** (botón «⛶ Ocultar interfaz» o tecla H): sólo la escena a pantalla completa; H otra vez para volver.

### Mejor luz volumétrica en 3D Studio
- **Los haces de los focos chocan con las cosas:** una pared, un mueble, el suelo o la silueta de un dibujo cortan el haz y dejan su «sombra» dentro de la luz, en vez de atravesarlo todo. Usa la sombra que el foco ya calcula, así que apenas cuesta más.
- **Aspecto más real:** más denso cerca del foco y más suave al alejarse, bordes difuminados, más brillo cuando miras hacia la luz y polvo flotando. Se ve bien también desde dentro del haz y mirando desde la base.
- **Cristal:** los objetos casi transparentes (ventanas de cristal) ya no proyectan sombra ni tapan los rayos del sol: la luz entra por las ventanas.
- El detalle del haz sigue la calidad de los efectos (baja, media o alta), y la calidad adaptativa lo baja sola si van pocos FPS.

### Versión anterior: YOSADRAW 1.14.0

### Descargas
- **Windows 64 bits:** `YOSADRAW-Setup-1.14.0-x64.exe` (instalador), `YOSADRAW-1.14.0-x64-portable.exe` o `YOSADRAW-1.14.0-win.zip` (portables, sin instalar: descomprime el zip y abre `YOSADRAW.exe`). Si SmartScreen avisa: «Más información» → «Ejecutar de todas formas».
- **Android 7.0 o superior:** `YOSADRAW-1.14.0.apk`. Instálalo encima de la versión anterior (tus proyectos se conservan).

### Nuevo en 3D Studio
- **Carteles PNG más reales en el modo En vivo:** al agarrarlos y moverlos con el ratón se inclinan, se balancean y giran según cómo los muevas (la parte que no agarras se queda atrás), con gelatina; al soltarlos vuelven a ponerse derechos solos y flotan donde los dejes. Los dibujos e imágenes nuevos vienen así; en «Física y control» de cada objeto dinámico se ajustan **Gelatina**, **Balanceo al arrastrar** y **Flota**.
- **Estilos de render (shaders):** **Squiggle vision** (las líneas tiemblan a pocos fotogramas por segundo, como dibujadas a mano, con velocidad y tamaño ajustables), contorno de **tinta** (con su color), **pintura al óleo**, **posterizar**, **semitono de cómic**, **píxel art**, **papel** y **líneas de TV**. Estilos listos: Squiggle vision, Boceto a lápiz, Cómic, Óleo, Píxel art y VHS. Se ven en vivo, en la vista previa y en los renders de imagen, MP4 y GIF (en los vídeos el squiggle se mueve fotograma a fotograma). Pestaña **Vivo → Estilo (shaders)** o **Escena → Render → Estilo**; la casilla «Con los efectos y el estilo» decide si el render los usa.
- Los efectos de la escena (luz volumétrica, resplandor, etc.) ahora también salen en los renders.

### Versión anterior: YOSADRAW 1.13.0

### Descargas
- **Windows 64 bits:** `YOSADRAW-Setup-1.13.0-x64.exe` (instalador), `YOSADRAW-1.13.0-x64-portable.exe` o `YOSADRAW-1.13.0-win.zip` (portables, sin instalar: descomprime el zip y abre `YOSADRAW.exe`). Si SmartScreen avisa: «Más información» → «Ejecutar de todas formas».
- **Android 7.0 o superior:** `YOSADRAW-1.13.0.apk`. Instálalo encima de la versión anterior (tus proyectos se conservan).

### Nuevo en 3D Studio: modo En vivo
La escena se ejecuta como un videojuego para crear animaciones: física, personajes, disparadores, programa y efectos, todo en tiempo real. Botón **▶ En vivo** (F5); Esc para.
- **Física:** cada objeto puede ser dinámico (cae, rebota, choca), estático (suelo, paredes), cinemático (sigue sus keyframes y empuja a los demás) o una zona que avisa cuando algo entra. Masa, rebote, rozamiento, forma de choque, gravedad y suelo infinito. Los terrenos chocan con su relieve.
- **Control con el ratón:** agarra cualquier objeto dinámico y muévelo, sacúdelo o lánzalo (la rueda lo acerca o aleja); arrastra en el suelo para que los personajes vayan hacia el puntero.
- **Personajes:** dirección (con flecha en el editor y «Apuntar en el visor»), velocidad, salto (Espacio), comportamiento (caminar, ir y volver, seguir al ratón, quieto), bloqueo por ejes, siempre de pie y efecto gelatina al moverse o al sacudirlos.
- **Disparadores:** «cuando pase algo, haz algo»: al empezar, en un segundo, cada X segundos, al pulsar una tecla, al hacer clic, al chocar, al entrar en una zona, al agarrar o soltar; acciones de empujar, saltar, cambiar dirección, velocidad o comportamiento, color, luz, efecto visual, temblor de cámara, soltar copias, ocultar o mostrar, gravedad, cámara lenta, parar o código. Con plantillas para empezar.
- **Programa (JavaScript):** `on('collide', 'Cubo', e => …)`, `every`, `after`, `obj('Nombre').impulse(…)`, `light('Foco').intensity(…)`, `fx('glitch', 0.5, 0.2)`, `shake`, `gravity`, `slowmo` y más. Los errores se muestran sin parar la escena; la primera vez se pide permiso para ejecutar el código.
- **Efectos en tiempo real:** luz volumétrica (rayos de sol que se cortan con los objetos y con la silueta de los dibujos), conos de luz en los focos, resplandor, aberración cromática, glitch, tinte de color del entorno, viñeta y grano; calidad de sombras; luces que parpadean, laten o giran. Se cambian mientras corre la escena y se pueden ver también al editar.
- **Dibujos en 3D:** tus dibujos de YOSADRAW (o imágenes) como carteles dentro de la escena: lo transparente se recorta, reciben las luces, las sombras y los efectos, y proyectan la sombra de su silueta; pueden mirar siempre a la cámara y tener física.
- **Grabar:** lo que pasa en vivo se guarda como keyframes (para renderizarlo o seguir editándolo) o directamente como vídeo con los efectos.
- **Rendimiento:** física a paso fijo con objetos que se duermen, efectos que se saltan cuando no hay ninguno activo, niveles de calidad (baja, media, alta) y calidad adaptativa que baja sola si van pocos FPS. La reproducción con keyframes ya no recalcula la geometría en cada fotograma.

### Versión anterior: YOSADRAW 1.12.0

### Descargas
- **Windows 64 bits:** `YOSADRAW-Setup-1.12.0-x64.exe` (instalador), `YOSADRAW-1.12.0-x64-portable.exe` o `YOSADRAW-1.12.0-win.zip` (portables, sin instalar: descomprime el zip y abre `YOSADRAW.exe`). Si SmartScreen avisa: «Más información» → «Ejecutar de todas formas».
- **Android 7.0 o superior:** `YOSADRAW-1.12.0.apk`. Instálalo encima de la versión anterior (tus proyectos se conservan).

### Nuevo: YOSADRAW 3D Studio
Un editor 3D completo dentro de YOSADRAW: «Nuevo proyecto → 3D». Pensado para quien nunca ha modelado.
- **Visor 3D:** girar (botón central o Alt + clic, o la mano para usar el botón izquierdo), acercar con la rueda, desplazar (Mayús + central o clic derecho), perspectiva u ortográfica, vistas de frente, lado y arriba, encuadrar lo elegido (F) o toda la escena, cuadrícula y ejes X, Y, Z que se pueden ocultar.
- **Formas básicas:** cubo, esfera, cilindro, cono, toroide, plano, cápsula y pirámide. Un clic en el suelo las pone; arrastrando se dibuja la base y luego la altura. Sus medidas se cambian después en el panel.
- **Transformar:** mover, rotar y escalar con gizmos por eje (G, R, S), valores exactos, límite de eje (X, Y, Z), ajuste a la cuadrícula, duplicar, eliminar, alinear, repartir, apoyar en el suelo, agrupar y desagrupar.
- **Modelado (Tab):** elegir vértices, aristas o caras con clic o rectángulo; extruir (también por regiones), inset, biselar, subdividir y suavizar (Catmull-Clark), fusionar vértices, borrar, empujar, invertir normales, abrir agujeros y unir dos caras con un túnel. Todo se puede deshacer.
- **Construir sin modelar:** escaleras, paredes (se dibujan arrastrando, con puerta y ventanas), puertas, ventanas, tejados, columnas, muebles (mesa, silla, estantería, cama, sofá), terrenos y árboles, con sus medidas y proporciones editables; «Casa de ejemplo» hace una casa completa con un clic. Construcción por bloques (clic pone, Mayús + clic quita).
- **Materiales:** color, rugosidad, metálico, transparencia, emisión y estilo de dibujo animado; texturas de imagen o de un **dibujo de YOSADRAW** (se actualiza si lo editas) y **pintar sobre el modelo** en vivo; un material distinto en cada cara; biblioteca de madera, metal, plástico, vidrio, piedra, ladrillo, tela, naturaleza y estilizados; favoritos para todos tus proyectos.
- **Luces y render:** sol, luz puntual, foco, ambiental y de entorno, con color, intensidad y sombras; exposición, niebla y fondo. Modos de vista sólido, alámbrico, materiales y render. Render de alta calidad a cualquier tamaño, con calidad de sombras y antialiasing, y fondo transparente.
- **Escenas:** jerarquía con grupos, carpetas, ocultar, bloquear, renombrar, arrastrar para organizar y buscar; varias escenas por proyecto y plantillas de escena que se reutilizan en otros proyectos.
- **Animación 3D:** keyframes (I) de posición, rotación, escala, opacidad, materiales, luces y cámaras con su propia línea de tiempo, reproducción, copiar y pegar entre objetos y curvas lineal, Bézier, Ease In, Ease Out, Ease In-Out, Smooth y suavizado automático. No afecta a las animaciones 2D.
- **Cámaras:** varias cámaras, cámara activa, campo de visión y distancia focal, ver por la cámara, colocarla donde miras, y moverla con keyframes.
- **Exportar e importar:** GLB y glTF (con materiales, texturas y animación), OBJ (+ .mtl), STL, PNG, MP4 y GIF. Importa GLB, glTF, OBJ y STL como objetos editables. Envía un render al lienzo 2D o úsalo como capa de referencia para dibujar encima.
- **Asistente 3D:** explica paso a paso la herramienta que usas y resalta dónde pulsar; tutorial guiado «Tu primera casa».
- Los proyectos 3D se guardan en la galería como cualquier otro (guardado automático y recuperación). Three.js sólo se carga al abrir un proyecto 3D: dibujar sigue igual de ligero.

### Versión anterior: YOSADRAW 1.11.0

### Descargas
- **Windows 64 bits:** `YOSADRAW-Setup-1.11.0-x64.exe` (instalador), `YOSADRAW-1.11.0-x64-portable.exe` o `YOSADRAW-1.11.0-win.zip` (portables, sin instalar: descomprime el zip y abre `YOSADRAW.exe`). Si SmartScreen avisa: «Más información» → «Ejecutar de todas formas».
- **Android 7.0 o superior:** `YOSADRAW-1.11.0.apk`. Instálalo encima de la versión anterior (tus proyectos se conservan).

### Animar más fácil en YOSADRAW MOTION
- **Auto Keyframe** (botón rojo ● de la línea de tiempo o Mayús+A): cualquier cambio de una propiedad (en el visor, en el panel o en la línea de tiempo) crea su keyframe en el cabezal. El visor se enmarca en rojo mientras está activo.
- **Crear keyframes sin ratón:** I crea keyframe (de la propiedad elegida o de las animadas de cada clip elegido, sin duplicar), Alt+I quita los del cabezal, J / K van al keyframe anterior / siguiente. Un clic en el rombo ◇ de cualquier propiedad crea o quita su keyframe.
- **Propiedades en la línea de tiempo:** cada pista se despliega (▸, Mayús+E / Alt+E para todas) y muestra una fila por propiedad animada con su curva, su valor editable (escribe o arrastra el nombre), su rombo y saltos ‹ ›. Puedes ver también las propiedades sin animar y cambiar la altura de cada pista arrastrando su borde.
- **Indicadores:** rombo vacío = sin animar, contorno dorado = animada, relleno = keyframe en el cabezal (también en el color del nombre). Al elegir un keyframe se ve su valor en la barra de la línea de tiempo.
- **Varias capas a la vez:** con «Sincronizar» (Mayús+Y) un rombo crea el keyframe en todos los clips elegidos, cada uno con su propio valor. Con varios clips elegidos el panel muestra «Keyframes en los N clips» con rombos por propiedad y un campo Δ que mueve todos lo mismo.
- **Copiar y pegar animaciones de varias capas:** Ctrl+C copia los keyframes elegidos de todas las capas (o toda la animación de los clips elegidos) y Ctrl+V los pega en el cabezal en otras capas, en el mismo orden y con la misma distancia entre ellas. También entre composiciones, en otra propiedad compatible, en sus tiempos originales o con **vista previa** (Ctrl+Mayús+V: los rombos fantasma siguen al puntero y un clic los coloca).
- **Línea de tiempo:** Mayús + clic elige un rango de keyframes, Ctrl + clic suma o quita, el recuadro funciona en las filas de propiedades, Alt + arrastrar duplica, Alt + clic borra, y la barra dorada sobre la regla estira o comprime la duración de lo elegido. El imán se ajusta también a otros keyframes (mantén Ctrl al arrastrar para desactivarlo un momento). Centrar en el cabezal (Mayús+C) y buscar capas por nombre (Ctrl+F).
- **Curvas:** barra rápida con Lineal, Ease In, Ease Out, Ease In-Out (F9), Smooth, Constante y **Auto** (suavizado automático con velocidad continua), para todos los keyframes elegidos. Invertir la curva y copiar / pegar curvas entre keyframes.
- **Herramientas:** duplicar la animación hacia delante o atrás, repetir N veces con espacio entre repeticiones, bucle hasta el final del clip (normal o ida y vuelta), alinear cada capa al cabezal, escalonar capas, congelar la animación en el cabezal.
- **Animación rápida:** entrada y salida deslizando (con dirección), Fade In/Out, Zoom In/Out, Rebote, Sacudida, Rotación, Pulso, Flotar, movimiento de cámara y animación de texto, con duración, intensidad, suavizado e inicio editables. Se aplica a todos los clips elegidos y sólo reemplaza el tramo que ocupa.
- **Capas:** vincular posición, escala, rotación u opacidad a otro clip (sigue su animación con su desfase), capa guía (se ve al editar, no se exporta), capa de ajuste (sus efectos y máscaras se aplican a todo lo de debajo), aislar pistas de vídeo, duraciones rápidas.
- **Interfaz:** «Buscar acción…» (Ctrl+P) encuentra cualquier herramienta, mostrar u ocultar la biblioteca (Alt+1) y las propiedades (Alt+2). Todos los atajos se pueden cambiar.
- **Atajos que cambian:** el inicio del intervalo de trabajo pasa a Mayús+I; «keyframe de transformación» (antes K) pasa a Mayús+K; keyframe anterior / siguiente pasan a J / K.
- Los proyectos anteriores se abren igual (se actualizan solos al formato nuevo) y todo se puede deshacer.

### Versión anterior: YOSADRAW 1.10.0

### Descargas
- **Windows 64 bits:** `YOSADRAW-Setup-1.10.0-x64.exe` (instalador), `YOSADRAW-1.10.0-x64-portable.exe` o `YOSADRAW-1.10.0-win.zip` (portables, sin instalar: descomprime el zip y abre `YOSADRAW.exe`). Si SmartScreen avisa: «Más información» → «Ejecutar de todas formas».
- **Android 7.0 o superior:** `YOSADRAW-1.10.0.apk`. Instálalo encima de la versión anterior (tus proyectos se conservan).

### Keyframes en YOSADRAW MOTION
- **Elegir varios a la vez:** arrastra en la fila de rombos de un clip (o Alt + arrastrar en vacío) para elegirlos con un recuadro, también en varios clips a la vez; Mayús/Ctrl + clic suma o quita uno.
- **Selección múltiple en el teléfono:** botón de la barra de la línea de tiempo o «Keyframes → Selección múltiple»: cada toque en un rombo lo suma o lo quita (Mayús+M en PC).
- **Mover juntos:** al arrastrar se mueven todos los elegidos, aunque estén en clips distintos, con imán al cabezal, marcadores y cortes, y una etiqueta con cuántos fotogramas se mueven.
- **Elegir rápido:** todos los del clip (Ctrl+Mayús+A, o Ctrl+A si ya hay rombos elegidos), los del cabezal (Alt+K) e invertir la selección.
- **Retocar el tiempo de los elegidos:** mover 1 fotograma (Alt+←/→) o 10 (Alt+Mayús+←/→), llevar al cabezal (Ctrl+Alt+K), duplicar en el cabezal (Ctrl+Alt+D), invertir la animación (Ctrl+Alt+R), estirar ×2, comprimir ×½ o cambiar la duración en %, y repartir a la misma distancia.
- Menú «⋯» de keyframes en la barra de la línea de tiempo, clic derecho en un rombo y botón «Keyframes» del teléfono con todas estas acciones. Todos los atajos se pueden cambiar.

### Versión anterior: YOSADRAW 1.9.1

### Descargas
- **Windows 64 bits:** `YOSADRAW-Setup-1.9.1-x64.exe` (instalador), `YOSADRAW-1.9.1-x64-portable.exe` o `YOSADRAW-1.9.1-win.zip` (portables, sin instalar: descomprime el zip y abre `YOSADRAW.exe`). Si SmartScreen avisa: «Más información» → «Ejecutar de todas formas».
- **Android 7.0 o superior:** `YOSADRAW-1.9.1.apk`. Instálalo encima de la versión anterior (tus proyectos se conservan).

### Correcciones
- **Combinar hacia abajo ya no borra el color de la capa de debajo.** Al transformar parte de un dibujo (o usar el borrador), la capa guardaba un «borrado» de esa zona; al combinarla con la capa de color, ese borrado se aplicaba también al relleno y aparecían huecos sin colorear. Ahora la capa de arriba entra aislada y el resultado es idéntico a lo que se veía antes de combinar.
- **Transformar una selección no pierde calidad:** lo seleccionado se mueve, escala y gira conservando los trazos y formas originales (antes se convertía en una imagen y al agrandarlo o girarlo quedaba borroso). Si aplicas sin mover nada, no queda ninguna marca en el borde de la selección.
- Las capas que ya se combinaron con una versión anterior conservan el hueco: deshaz la combinación (Ctrl+Z) o vuelve a rellenar esa zona.

### Versión anterior: YOSADRAW 1.9.0

### Descargas
- **Windows 64 bits:** `YOSADRAW-Setup-1.9.0-x64.exe` (instalador), `YOSADRAW-1.9.0-x64-portable.exe` o `YOSADRAW-1.9.0-win.zip` (portables, sin instalar: descomprime el zip y abre `YOSADRAW.exe`). Si SmartScreen avisa: «Más información» → «Ejecutar de todas formas».
- **Android 7.0 o superior:** `YOSADRAW-1.9.0.apk`. Instálalo encima de la versión anterior (tus proyectos se conservan).

### YOSADRAW MOTION (editor de vídeo)
- **Importar las capas de un dibujo de una vez:** en «De YOSADRAW» elige *Capas por separado*, marca las que quieras (Todas / Ninguna / Sólo las visibles; se indica su carpeta) y se añaden todas juntas a la biblioteca y, si quieres, a la línea de tiempo en el cabezal: una pista por capa, alineadas y en el mismo orden que en el dibujo. El papel va con la capa de más abajo.
- **Copiar y pegar keyframes con botones:** en la barra de la línea de tiempo (copiar los rombos elegidos o todos los del clip, y pegarlos en el cabezal en otro clip). En el teléfono, botón **Keyframes** con copiar, pegar, borrar, transformar e ir al anterior/siguiente.
- **24 animaciones nuevas:** entradas (Desplegar, Rodar, Remolino, Zoom desde lejos, Abrir, Aplastar y saltar, Glitch, Golpe seco), salidas (Rebotar, Rodar, Remolino, Aplastar, Plegar, Glitch, Hundirse) y bucles (Ola, Parpadeo de luz, Péndulo, Zoom lento, Ken Burns, Deriva, Saltos glitch, Bamboleo, Levitar inclinado). Ya son 70.
- **16 filtros nuevos:** Teal y naranja, Bleach bypass, Cyberpunk, Mate, Hora dorada, Luz de luna, Retro años 70, Lomo, Infrarrojo, Pop art, Cámara térmica, Hielo, Fuego, Sueño, Tinta china y Película antigua. Ya son 36.
- **6 efectos nuevos** (también en el dibujo): Ondas en el agua, Ojo de pez, Fuga de luz, Boceto a lápiz, Bordes de neón y Rayos de luz.
- **Más fluido:** el compositor reutiliza sus lienzos (composiciones anidadas y desenfoque de movimiento ya no crean imágenes nuevas en cada fotograma) y los dibujos importados por capas comparten la lectura del proyecto.

### Carpetas de capas
- **Ocultar una carpeta oculta de verdad sus capas** en el lienzo (antes podían seguir viéndose). En el panel, las capas de una carpeta oculta se ven atenuadas.

### Versión anterior: YOSADRAW 1.8.0

### Descargas
- **Windows 64 bits:** `YOSADRAW-Setup-1.8.0-x64.exe` (instalador), `YOSADRAW-1.8.0-x64-portable.exe` o `YOSADRAW-1.8.0-win.zip` (portables, sin instalar: descomprime el zip y abre `YOSADRAW.exe`). Si SmartScreen avisa: «Más información» → «Ejecutar de todas formas».
- **Android 7.0 o superior:** `YOSADRAW-1.8.0.apk`. Instálalo encima de la versión anterior (tus proyectos se conservan).

### Rendimiento con muchas capas, colores y efectos
- **Pila de capas compactada:** mientras dibujas, las capas de debajo de la activa (y los tramos de capas normales de encima) se muestran combinadas en una sola imagen, idéntica a la original (también con Multiplicar, Trama, Superponer o Luz suave). La pantalla compone 2–3 imágenes en lugar de una por capa. Se rehace sólo cuando cambia otra capa.
- **Imágenes grandes a la escala justa:** al alejar el zoom, los rellenos, imágenes y capas con efectos se dibujan desde una versión reducida preparada una vez, en lugar de reducir la imagen entera en cada repintado.
- **Efectos recortados a su contenido:** un efecto aplicado a una capa ya no deja una imagen del tamaño de todo el documento, sólo de la zona dibujada (menos memoria, repintado más rápido).
- En una prueba con 12 capas con trazos, rellenos, modos de fusión y efectos, los parones al pintar bajaron de ~1,9 s a ~30 ms y al hacer zoom de ~1,6 s a ~30 ms.

### Armonías de color mejoradas
- Elige el esquema (complementario, divididos, análogos, tríada, tétrada, monocromático, luces y sombras) con la rueda de **pintor (RYB)** o de **luz (RGB)**.
- Cada color con su **papel y proporción** (regla 60-30-10: dominante, secundario, acento), barra de proporciones y **consejos de uso** del esquema.
- **Colorear con capas de fusión:** para el color actual, el color exacto que hay que usar en una capa **Multiplicar** (sombras frías), **Trama** (luces cálidas), **Superponer** (ambiente), **Luz suave** (luz rebotada) y **Sobreexponer color** (brillos), con la cuenta a la vista (color de debajo + color de la capa = resultado) y un botón que crea la capa con su modo y el color listos.

### Versión anterior: YOSADRAW 1.7.0

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
