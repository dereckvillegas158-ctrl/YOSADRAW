# Táctico — base de shooter táctico en Godot 4

Base jugable de un shooter táctico y realista en primera persona, pensada para
funcionar en computadoras modestas: usa el renderizador **Compatibility**
(OpenGL 3) y gráficos de bloques simples que luego puedes cambiar por modelos.

## Cómo abrirlo

1. Descarga **Godot 4.3** o una versión 4.x más nueva (la versión normal, no la .NET): https://godotengine.org/download
2. Abre Godot → **Importar** → elige el archivo `tactico/project.godot`.
3. Pulsa **F5** (o el botón ▶) para jugar.

## Controles

| Acción | Tecla |
|---|---|
| Moverse | W A S D |
| Correr | Shift |
| Saltar | Espacio |
| Agacharse | C o Ctrl |
| Inclinarse (asomarse) | Q / E |
| Disparar | Clic izquierdo |
| Apuntar con la mira | Clic derecho |
| Recargar | R |
| Modo de disparo (auto / semi) | B |
| Soltar el ratón | Esc |
| Reiniciar | Enter |

## Qué incluye

**Jugador** (`scripts/jugador.gd`)
- Movimiento con inercia: caminar, correr, agacharse (no te levantas si hay un techo encima) y saltar.
- Inclinarse a los lados para asomarse por esquinas; se limita solo si hay una pared.
- Apuntar con la mira: menos campo de visión, menos dispersión, menos sensibilidad y punto rojo.
- Disparo por raycast (impacto instantáneo) con **dispersión real**: aumenta al moverte, saltar o disparar seguido; baja al agacharte o apuntar. La mira del HUD se abre exactamente lo que se dispersan las balas.
- **Retroceso**: parte sube la mira de verdad (hay que compensar con el ratón) y parte se recupera sola.
- **Cargadores reales**: al recargar guardas el cargador a medias, metes el más lleno y conservas la bala en la recámara (30 + 1). La recarga con el arma vacía tarda más.
- Daño por zonas: un tiro a la cabeza hace ×4 de daño.
- **Supresión**: si una bala pasa cerca, la vista tiembla y cuesta más apuntar.

**Enemigos** (`scripts/enemigo.gd`)
- Patrullan rutas usando una malla de navegación (rodean obstáculos).
- **Detección gradual**: no te ven al instante; tardan menos si estás cerca, de pie o corriendo. El HUD te avisa cuando alguien te está viendo.
- Oyen tus disparos y van a investigar, con error según la distancia.
- Avisan a sus compañeros cercanos cuando te descubren.
- Tiempo de reacción humano antes de disparar y ráfagas cortas con imprecisión según la distancia y tu movimiento.
- Cuando están heridos buscan cobertura que tú no puedas ver; luego salen a buscarte a tu última posición conocida.

**Nivel** (`scripts/nivel.gd`): un mapa de 64 × 64 m con un edificio, contenedores, muros de sacos (cubren si te agachas), cajas y muros altos. La navegación se calcula al arrancar y los puntos de cobertura se generan solos.

**HUD** (`scripts/hud.gd`): munición y cargadores de reserva, vida, modo de disparo, postura, enemigos restantes, marcador de impacto, destello de daño y mensajes de victoria o derrota.

## Estructura

```
tactico/
├── project.godot
├── escenas/
│   ├── main.tscn       # escena principal: luz, entorno, nivel, jugador y HUD
│   ├── jugador.tscn    # cuerpo, cámara y arma
│   └── enemigo.tscn    # soldado con hitbox de cuerpo y de cabeza
└── scripts/
    ├── controles.gd    # registra las teclas al arrancar
    ├── jugador.gd
    ├── enemigo.gd
    ├── nivel.gd
    ├── hud.gd
    └── util.gd         # dispersión de balas y zonas de impacto
```

Casi todos los valores (velocidades, daño, cadencia, tiempos de recarga, visión
de los enemigos…) son `@export`: puedes cambiarlos desde el Inspector sin tocar código.

## Ideas para seguir

- Sonido: disparos, pasos, recarga e impactos (y que los pasos también alerten a la IA).
- Modelos y animaciones reales (por ejemplo, hechos en Blender) en lugar de bloques.
- Más armas, granadas y destrucción de cobertura.
- Mapas diseñados a mano en el editor y objetivos de misión (rescate, desactivar, extracción).
- Compañeros de equipo con órdenes, o multijugador.
- Menú de opciones: sensibilidad, gráficos y teclas.
