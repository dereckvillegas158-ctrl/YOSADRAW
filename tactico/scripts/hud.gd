extends CanvasLayer
## Interfaz: mira dinámica (se abre con la dispersión real del arma), munición
## y cargadores, vida, marcador de impacto, destello de daño y mensajes.

const AYUDA := "WASD mover · Shift correr · Espacio saltar · C agacharse · Q/E inclinarse\n" \
	+ "Clic izq. disparar · Clic der. apuntar · R recargar · B modo de disparo · Esc soltar ratón · Enter reiniciar"

var jugador: Jugador
var nivel: Nivel

var mira: Control
var municion: Label
var vida: Label
var info: Label
var centro: Label
var ayuda: Label
var destello: ColorRect

var t_marcador := 0.0
var marcador_mortal := false
var t_ayuda := 10.0


func _ready() -> void:
	add_to_group("hud")
	jugador = get_tree().get_first_node_in_group("jugador")
	nivel = get_tree().get_first_node_in_group("nivel")

	destello = ColorRect.new()
	destello.color = Color(0.7, 0.0, 0.0, 0.0)
	destello.mouse_filter = Control.MOUSE_FILTER_IGNORE
	destello.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(destello)

	mira = Control.new()
	mira.mouse_filter = Control.MOUSE_FILTER_IGNORE
	mira.set_anchors_preset(Control.PRESET_FULL_RECT)
	mira.draw.connect(_dibujar_mira)
	add_child(mira)

	municion = _etiqueta(30, Vector4(1, 1, 1, 1), Vector4(-420, -96, -28, -24), HORIZONTAL_ALIGNMENT_RIGHT)
	vida = _etiqueta(30, Vector4(0, 1, 0, 1), Vector4(28, -96, 360, -24), HORIZONTAL_ALIGNMENT_LEFT)
	info = _etiqueta(18, Vector4(0, 0, 0, 0), Vector4(24, 18, 760, 60), HORIZONTAL_ALIGNMENT_LEFT)
	info.vertical_alignment = VERTICAL_ALIGNMENT_TOP
	ayuda = _etiqueta(15, Vector4(1, 0, 1, 0), Vector4(-820, 18, -24, 70), HORIZONTAL_ALIGNMENT_RIGHT)
	ayuda.text = AYUDA
	ayuda.vertical_alignment = VERTICAL_ALIGNMENT_TOP
	centro = _etiqueta(40, Vector4(0, 0, 1, 1), Vector4(0, 0, 0, 0), HORIZONTAL_ALIGNMENT_CENTER)
	centro.vertical_alignment = VERTICAL_ALIGNMENT_CENTER


## anclas = (izq, arriba, der, abajo); margenes = desplazamientos en píxeles.
func _etiqueta(tamano: int, anclas: Vector4, margenes: Vector4, alineacion: HorizontalAlignment) -> Label:
	var l := Label.new()
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	l.anchor_left = anclas.x
	l.anchor_top = anclas.y
	l.anchor_right = anclas.z
	l.anchor_bottom = anclas.w
	l.offset_left = margenes.x
	l.offset_top = margenes.y
	l.offset_right = margenes.z
	l.offset_bottom = margenes.w
	l.horizontal_alignment = alineacion
	l.vertical_alignment = VERTICAL_ALIGNMENT_BOTTOM
	l.add_theme_font_size_override("font_size", tamano)
	l.add_theme_constant_override("outline_size", 6)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.85))
	add_child(l)
	return l


func _process(delta: float) -> void:
	if jugador == null:
		return
	t_marcador -= delta
	destello.color.a = move_toward(destello.color.a, 0.0, delta * 0.8)
	t_ayuda -= delta
	ayuda.modulate.a = clampf(t_ayuda, 0.0, 1.0)

	var reserva := " ".join(jugador.cargadores.map(func(n: int) -> String: return str(n)))
	if jugador.recargando:
		municion.text = "RECARGANDO…\n%s" % reserva
	elif jugador.rondas == 0:
		municion.text = "SIN MUNICIÓN — R\n%s" % (reserva if reserva != "" else "sin cargadores")
	else:
		municion.text = "%d   [%s]\n%s" % [jugador.rondas, "AUTO" if jugador.automatico else "SEMI", reserva]
	municion.modulate = Color(1, 0.45, 0.35) if jugador.rondas <= 5 else Color.WHITE

	vida.text = "+ %d" % int(jugador.vida)
	vida.modulate = Color(1, 0.35, 0.3) if jugador.vida < 35.0 else Color.WHITE

	var postura := "Agachado" if jugador.agachado else ("Corriendo" if jugador.corriendo else "De pie")
	var alerta := 0.0
	for e: Enemigo in get_tree().get_nodes_in_group("enemigos"):
		if e.estado == Enemigo.Estado.PATRULLA or e.estado == Enemigo.Estado.INVESTIGAR:
			alerta = maxf(alerta, e.deteccion)
	var aviso := ""
	if alerta > 0.05:
		aviso = "    " + ("◉ TE ESTÁN VIENDO" if alerta > 0.5 else "○ algo te ha visto")
	info.text = "Enemigos: %d    Postura: %s%s" % [nivel.enemigos_restantes if nivel else 0, postura, aviso]
	mira.queue_redraw()


func _dibujar_mira() -> void:
	var c := mira.size * 0.5
	var alfa := (1.0 - jugador.factor_apuntado) * (0.0 if jugador.corriendo or not jugador.vivo else 0.9)
	if alfa > 0.01:
		# Separación en píxeles = dispersión real proyectada en pantalla.
		var media_fov := deg_to_rad(jugador.camara.fov * 0.5)
		var hueco := tan(deg_to_rad(jugador.dispersion_actual())) / tan(media_fov) * c.y
		hueco = maxf(hueco, 4.0)
		var col := Color(1, 1, 1, alfa)
		for d: Vector2 in [Vector2.RIGHT, Vector2.LEFT, Vector2.UP, Vector2.DOWN]:
			mira.draw_line(c + d * hueco, c + d * (hueco + 9.0), col, 2.0)
	if t_marcador > 0.0:
		var col := Color(1, 0.2, 0.15) if marcador_mortal else Color.WHITE
		col.a = clampf(t_marcador / 0.2, 0.0, 1.0)
		for d: Vector2 in [Vector2(1, 1), Vector2(-1, 1), Vector2(1, -1), Vector2(-1, -1)]:
			mira.draw_line(c + d * 5.0, c + d * 12.0, col, 2.0)


func marcar_impacto(mortal: bool) -> void:
	t_marcador = 0.25
	marcador_mortal = mortal


func recibir_dano() -> void:
	destello.color.a = minf(destello.color.a + 0.3, 0.5)


func mostrar_mensaje(texto: String) -> void:
	centro.text = texto
