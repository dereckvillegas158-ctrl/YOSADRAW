class_name Enemigo
extends CharacterBody3D
## Soldado enemigo: patrulla, oye disparos, avisa a sus compañeros, reacciona
## con un pequeño retraso, dispara en ráfagas y busca cobertura cuando lo hieren.

signal murio

enum Estado { PATRULLA, INVESTIGAR, COMBATE, COBERTURA, MUERTO }

@export var vida := 100.0
@export var velocidad_patrulla := 1.7
@export var velocidad_carrera := 4.2
@export var distancia_vision := 45.0
@export var tiempo_deteccion := 1.2 # segundos viéndote de pie a media distancia hasta reaccionar
@export var angulo_vision := 65.0 # mitad del cono de visión, en grados
@export var dano := 14.0
@export var alcance_oido := 28.0
@export var alcance_aviso := 18.0

const MULTIPLICADOR_CABEZA := 4.0

## Puntos de la patrulla (los asigna el nivel antes de añadirlo a la escena).
var ruta: Array[Vector3] = []
var nivel: Nivel

var estado := Estado.PATRULLA
var indice_ruta := 0
var jugador: Jugador
var ve_al_jugador := false
var deteccion := 0.0 # 0..1: al llenarse, el enemigo te ha descubierto
var ultima_posicion_vista := Vector3.ZERO
var tiempo_sin_ver := 0.0
var tiempo_reaccion := 0.0
var balas_rafaga := 0
var espera_disparo := 0.0
var espera := 0.0
var objetivo_mov := Vector3.ZERO
var yaw_objetivo := 0.0
var t_vision := 0.0
var t_fogonazo := 0.0
var gravedad: float = ProjectSettings.get_setting("physics/3d/default_gravity")

@onready var agente: NavigationAgent3D = $Agente
@onready var ojos: Marker3D = $Ojos
@onready var modelo: Node3D = $Modelo
@onready var boca: Marker3D = $Modelo/Arma/Boca
@onready var fogonazo: OmniLight3D = $Modelo/Arma/Boca/Fogonazo


func _ready() -> void:
	jugador = get_tree().get_first_node_in_group("jugador") as Jugador
	if ruta.is_empty():
		ruta = [global_position]
	if ruta.size() > 1:
		_mirar_hacia(ruta[1]) # empieza mirando hacia su siguiente punto
		rotation.y = yaw_objetivo
	yaw_objetivo = rotation.y
	t_vision = randf() * 0.15 # repartir las comprobaciones entre fotogramas


func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity.y -= gravedad * delta
	t_fogonazo -= delta
	fogonazo.visible = t_fogonazo > 0.0

	t_vision -= delta
	if t_vision <= 0.0:
		t_vision = 0.15
		ve_al_jugador = _puede_ver_jugador()

	var en_guardia := estado == Estado.PATRULLA or estado == Estado.INVESTIGAR
	if ve_al_jugador and en_guardia:
		# Antes de reaccionar tiene que "procesar" lo que ve: más rápido si estás
		# cerca, de pie o moviéndote; más lento si estás lejos y agachado.
		deteccion = minf(deteccion + delta * _ritmo_deteccion(), 1.0)
		if deteccion >= 1.0:
			_mirar_hacia(jugador.global_position)
			_entrar_combate(estado == Estado.INVESTIGAR)
		elif deteccion > 0.5 and estado == Estado.PATRULLA:
			_ir_a_investigar(jugador.global_position) # "¿qué fue eso?"
	elif en_guardia:
		deteccion = maxf(deteccion - delta * 0.25, 0.0)
	if ve_al_jugador and not en_guardia:
		ultima_posicion_vista = jugador.global_position
		tiempo_sin_ver = 0.0
	elif not ve_al_jugador:
		tiempo_sin_ver += delta

	match estado:
		Estado.PATRULLA:
			_patrullar(delta)
		Estado.INVESTIGAR:
			_investigar(delta)
		Estado.COMBATE:
			_combatir(delta)
		Estado.COBERTURA:
			_cubrirse(delta)

	rotation.y = lerp_angle(rotation.y, yaw_objetivo, 1.0 - exp(-8.0 * delta))
	move_and_slide()


# ---------------------------------------------------------------- Percepción

func _puede_ver_jugador() -> bool:
	if jugador == null or not jugador.vivo:
		return false
	var desde := ojos.global_position
	var hacia := jugador.punto_cabeza() - desde
	var alcance := distancia_vision
	if jugador.agachado and estado == Estado.PATRULLA:
		alcance *= 0.55 # agachado es más difícil de detectar
	if hacia.length() > alcance:
		return false
	var cono := angulo_vision if estado != Estado.COMBATE else 90.0
	var adelante := -global_basis.z
	if rad_to_deg(adelante.angle_to(Vector3(hacia.x, 0.0, hacia.z))) > cono:
		return false
	# Se ve si la cabeza o el pecho están a la vista (asomarse muestra la cabeza).
	for altura in [0.0, -0.5]:
		if _linea_libre(desde, jugador.punto_cabeza() + Vector3(0.0, altura, 0.0)):
			return true
	return false


func _ritmo_deteccion() -> float:
	var distancia := ojos.global_position.distance_to(jugador.punto_cabeza())
	var lejania := clampf(distancia / distancia_vision, 0.0, 1.0)
	var ritmo := 2.5 * pow(1.0 - lejania, 2.0) + 0.15
	if jugador.agachado:
		ritmo *= 0.5
	var velocidad := Vector2(jugador.velocity.x, jugador.velocity.z).length()
	if velocidad < 0.5:
		ritmo *= 0.6 # quieto se nota menos
	elif velocidad > 4.5:
		ritmo *= 1.5 # correr llama la atención
	if estado == Estado.INVESTIGAR:
		ritmo *= 2.0 # ya estaba alerta
	return ritmo / tiempo_deteccion


func _linea_libre(desde: Vector3, hasta: Vector3) -> bool:
	var consulta := PhysicsRayQueryParameters3D.create(desde, hasta, 1 | 2, [get_rid()])
	var res := get_world_3d().direct_space_state.intersect_ray(consulta)
	return not res.is_empty() and res["collider"] == jugador


## El jugador disparó: si está cerca, va a investigar (con error según la distancia).
func oir_disparo(posicion: Vector3) -> void:
	if estado != Estado.PATRULLA and estado != Estado.INVESTIGAR:
		return
	var distancia := global_position.distance_to(posicion)
	if distancia > alcance_oido:
		return
	var error := distancia * 0.15
	_ir_a_investigar(posicion + Vector3(randf_range(-error, error), 0.0, randf_range(-error, error)))


## Un compañero vio al jugador.
func aviso_aliado(posicion: Vector3, origen: Vector3) -> void:
	if estado == Estado.PATRULLA and global_position.distance_to(origen) < alcance_aviso:
		_ir_a_investigar(posicion)


# ---------------------------------------------------------------- Estados

func _patrullar(delta: float) -> void:
	var destino := ruta[indice_ruta]
	if _distancia_plana(destino) < 0.8:
		_frenar()
		espera += delta
		if espera > 2.5:
			espera = 0.0
			indice_ruta = (indice_ruta + 1) % ruta.size()
			if ruta.size() == 1:
				yaw_objetivo += randf_range(-1.5, 1.5) # vigila mirando a los lados
		return
	_navegar_hacia(destino, velocidad_patrulla)


func _ir_a_investigar(posicion: Vector3) -> void:
	estado = Estado.INVESTIGAR
	objetivo_mov = posicion
	agente.target_position = posicion
	espera = 0.0


func _investigar(delta: float) -> void:
	if _distancia_plana(objetivo_mov) > 1.2 and espera == 0.0 and not agente.is_navigation_finished():
		_navegar_hacia(objetivo_mov, velocidad_carrera * 0.7)
		return
	# Llegó: mira alrededor un rato y vuelve a patrullar.
	_frenar()
	var antes := espera
	espera += delta
	if floorf(espera / 1.3) != floorf(antes / 1.3):
		yaw_objetivo += randf_range(-2.0, 2.0)
	if espera > 6.0:
		estado = Estado.PATRULLA
		espera = 0.0
		indice_ruta = _punto_de_ruta_mas_cercano()


func _entrar_combate(ya_alerta: bool) -> void:
	estado = Estado.COMBATE
	deteccion = 1.0
	ultima_posicion_vista = jugador.global_position
	tiempo_sin_ver = 0.0
	tiempo_reaccion = randf_range(0.25, 0.45) if ya_alerta else randf_range(0.45, 0.85)
	balas_rafaga = 0
	espera_disparo = 0.0
	_frenar()
	get_tree().call_group("enemigos", "aviso_aliado", ultima_posicion_vista, global_position)


func _combatir(delta: float) -> void:
	_frenar()
	_mirar_hacia(ultima_posicion_vista)
	if not ve_al_jugador:
		if tiempo_sin_ver > 1.2:
			_ir_a_investigar(ultima_posicion_vista) # avanza a su última posición conocida
		return
	tiempo_reaccion -= delta
	if tiempo_reaccion > 0.0:
		return
	espera_disparo -= delta
	if espera_disparo > 0.0:
		return
	if balas_rafaga > 0:
		_disparar()
		balas_rafaga -= 1
		espera_disparo = 0.12
	else:
		balas_rafaga = randi_range(3, 5)
		espera_disparo = randf_range(0.5, 1.1)


func _buscar_cobertura() -> void:
	if nivel == null:
		return
	var mejor := Vector3.ZERO
	var mejor_distancia := INF
	for punto in nivel.puntos_cobertura:
		var d := global_position.distance_to(punto)
		if d < 14.0 and d < mejor_distancia and _punto_oculto(punto):
			mejor = punto
			mejor_distancia = d
	if mejor_distancia < INF:
		estado = Estado.COBERTURA
		objetivo_mov = mejor
		agente.target_position = mejor
		espera = randf_range(2.0, 4.0)


func _punto_oculto(punto: Vector3) -> bool:
	var desde := punto + Vector3.UP * 1.5
	var consulta := PhysicsRayQueryParameters3D.create(desde, jugador.punto_cabeza(), 1)
	return not get_world_3d().direct_space_state.intersect_ray(consulta).is_empty()


func _cubrirse(delta: float) -> void:
	if _distancia_plana(objetivo_mov) > 0.8 and not agente.is_navigation_finished():
		_navegar_hacia(objetivo_mov, velocidad_carrera)
		return
	_frenar()
	_mirar_hacia(ultima_posicion_vista)
	espera -= delta
	if espera <= 0.0:
		estado = Estado.COMBATE # sale a buscarlo
		tiempo_reaccion = 0.3


# ---------------------------------------------------------------- Disparo y daño

func _disparar() -> void:
	t_fogonazo = 0.05
	var desde := boca.global_position
	var objetivo := jugador.punto_cabeza() - Vector3(0.0, randf_range(0.1, 0.6), 0.0)
	var distancia := desde.distance_to(objetivo)
	var dispersion := 2.2 + distancia * 0.05
	dispersion += Vector2(jugador.velocity.x, jugador.velocity.z).length() / 3.0
	var dir := Util.desviar((objetivo - desde).normalized(), dispersion)
	var fin := desde + dir * 200.0
	var consulta := PhysicsRayQueryParameters3D.create(desde, fin, 1 | 2 | 4, [get_rid()])
	var res := get_world_3d().direct_space_state.intersect_ray(consulta)
	if not res.is_empty():
		fin = res["position"]
		var golpeado: Object = res["collider"]
		if golpeado == jugador:
			jugador.recibir_impacto(dano * randf_range(0.8, 1.2), "Cuerpo", fin, dir, self)
			return
		if not golpeado is Enemigo:
			get_tree().call_group("nivel", "crear_marca", fin, res["normal"])
	# Bala que pasa cerca: supresión.
	var cabeza := jugador.punto_cabeza()
	var cercano := Geometry3D.get_closest_point_to_segment(cabeza, desde, fin)
	var separacion := cercano.distance_to(cabeza)
	if separacion < 1.5:
		jugador.supresion(1.0 - separacion / 1.5)


func recibir_impacto(dano_recibido: float, zona: String, _punto: Vector3, _dir: Vector3, atacante: Node3D) -> bool:
	if estado == Estado.MUERTO:
		return false
	vida -= dano_recibido * (MULTIPLICADOR_CABEZA if zona == "Cabeza" else 1.0)
	if vida <= 0.0:
		_morir()
		return true
	if atacante:
		ultima_posicion_vista = atacante.global_position
		_mirar_hacia(ultima_posicion_vista)
	if estado == Estado.PATRULLA or estado == Estado.INVESTIGAR:
		_entrar_combate(true)
	else:
		tiempo_reaccion = maxf(tiempo_reaccion, 0.2) # el impacto lo desconcentra
	if estado == Estado.COMBATE and vida < 70.0 and randf() < 0.6:
		_buscar_cobertura()
	return false


func _morir() -> void:
	estado = Estado.MUERTO
	remove_from_group("enemigos")
	collision_layer = 0
	$Cuerpo.set_deferred("disabled", true)
	$Cabeza.set_deferred("disabled", true)
	fogonazo.visible = false
	set_physics_process(false)
	var tween := create_tween().set_parallel()
	tween.tween_property(modelo, "rotation:x", -PI * 0.5, 0.45).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
	tween.tween_property(modelo, "position:y", 0.25, 0.45)
	murio.emit()


# ---------------------------------------------------------------- Movimiento

func _navegar_hacia(destino: Vector3, velocidad: float) -> void:
	if agente.target_position.distance_to(destino) > 0.5:
		agente.target_position = destino
	var siguiente := agente.get_next_path_position()
	if agente.get_current_navigation_path().is_empty():
		siguiente = destino # sin malla de navegación: en línea recta
	var dir := siguiente - global_position
	dir.y = 0.0
	if dir.length() < 0.05:
		_frenar()
		return
	dir = dir.normalized()
	velocity.x = dir.x * velocidad
	velocity.z = dir.z * velocidad
	yaw_objetivo = atan2(-dir.x, -dir.z)


func _frenar() -> void:
	velocity.x = 0.0
	velocity.z = 0.0


func _mirar_hacia(punto: Vector3) -> void:
	var dir := punto - global_position
	if Vector2(dir.x, dir.z).length() > 0.1:
		yaw_objetivo = atan2(-dir.x, -dir.z)


func _distancia_plana(punto: Vector3) -> float:
	return Vector2(punto.x - global_position.x, punto.z - global_position.z).length()


func _punto_de_ruta_mas_cercano() -> int:
	var mejor := 0
	for i in ruta.size():
		if _distancia_plana(ruta[i]) < _distancia_plana(ruta[mejor]):
			mejor = i
	return mejor
