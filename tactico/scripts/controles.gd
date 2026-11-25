extends Node
## Registra los controles del juego al arrancar (así no dependen del editor).
## Puedes cambiarlos aquí o añadir más en Proyecto > Configuración > Mapa de entrada.

const TECLAS := {
	"adelante": [KEY_W],
	"atras": [KEY_S],
	"izquierda": [KEY_A],
	"derecha": [KEY_D],
	"saltar": [KEY_SPACE],
	"correr": [KEY_SHIFT],
	"agacharse": [KEY_C, KEY_CTRL],
	"inclinar_izq": [KEY_Q],
	"inclinar_der": [KEY_E],
	"recargar": [KEY_R],
	"modo_disparo": [KEY_B],
	"reiniciar": [KEY_ENTER],
	"liberar_raton": [KEY_ESCAPE],
}

const BOTONES := {
	"disparar": MOUSE_BUTTON_LEFT,
	"apuntar": MOUSE_BUTTON_RIGHT,
}


func _ready() -> void:
	for accion: String in TECLAS:
		_asegurar_accion(accion)
		for tecla: Key in TECLAS[accion]:
			var ev := InputEventKey.new()
			ev.physical_keycode = tecla
			InputMap.action_add_event(accion, ev)
	for accion: String in BOTONES:
		_asegurar_accion(accion)
		var ev := InputEventMouseButton.new()
		ev.button_index = BOTONES[accion]
		InputMap.action_add_event(accion, ev)


func _asegurar_accion(accion: String) -> void:
	if not InputMap.has_action(accion):
		InputMap.add_action(accion)
