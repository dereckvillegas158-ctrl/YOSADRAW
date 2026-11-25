class_name Jugador
extends CharacterBody3D
## Jugador en primera persona: movimiento táctico, agacharse, inclinarse,
## apuntar con la mira y un fusil con retroceso, dispersión y cargadores reales.

signal murio

# --- Movimiento ---
@export var velocidad_caminar := 4.0
@export var velocidad_correr := 6.5
@export var velocidad_agachado := 2.0
@export var velocidad_apuntando := 2.4
@export var aceleracion_suelo := 12.0
@export var aceleracion_aire := 2.0
@export var fuerza_salto := 4.2
@export var sensibilidad := 0.0022

# --- Arma ---
@export var cadencia_rpm := 650.0
@export var dano_base := 34.0
@export var capacidad_cargador := 30
@export var cargadores_extra := 3
@export var tiempo_recarga := 2.2
@export var tiempo_recarga_vacio := 2.8
@export var alcance := 250.0

const ALTURA_DE_PIE := 1.8
const ALTURA_AGACHADO := 1.15
const OJOS_DE_PIE := 1.65
const OJOS_AGACHADO := 1.0
const INCLINACION_ANGULO := 0.21 # unos 12 grados
const INCLINACION_DESPLAZAMIENTO := 0.4
const POS_ARMA_CADERA := Vector3(0.22, -0.2, -0.45)
const POS_ARMA_MIRA := Vector3(0.0, -0.095, -0.33) # el punto rojo queda en el centro
const FOV_NORMAL := 75.0
const FOV_MIRA := 50.0
const MASCARA_DISPARO := 1 | 4 # mundo + enemigos

var vida := 100.0
var vivo := true

# Postura y cámara
var pitch := 0.0
var agachado := false
var corriendo := false
var apuntando := false
var factor_apuntado := 0.0 # 0 = cadera, 1 = mira
var inclinacion := 0.0 # -1 izquierda … 1 derecha
var sacudida := 0.0
var balanceo := 0.0

# Arma
var rondas := 0
var cargadores: Array[int] = []
var automatico := true
var recargando := false
var recarga_restante := 0.0
var espera_disparo := 0.0
var gatillo_suelto := true
var retroceso := Vector2.ZERO # x = vertical, y = horizontal (radianes, se recupera solo)
var floracion := 0.0 # dispersión extra por disparar seguido (grados)
var patada := 0.0
var t_fogonazo := 0.0

var gravedad: float = ProjectSettings.get_setting("physics/3d/default_gravity")
var _forma: CapsuleShape3D

@onready var colision: CollisionShape3D = $Colision
@onready var cabeza: Node3D = $Cabeza
@onready var camara: Camera3D = $Cabeza/Camara
@onready var arma: Node3D = $Cabeza/Camara/Arma
@onready var fogonazo: OmniLight3D = $Cabeza/Camara/Arma/Boca/Fogonazo


func _ready() -> void:
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	_forma = colision.shape.duplicate()
	colision.shape = _forma
	rondas = capacidad_cargador
	for i in cargadores_extra:
		cargadores.append(capacidad_cargador)


func _unhandled_input(event: InputEvent) -> void:
	if not vivo:
		return
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		var sens := sensibilidad * lerpf(1.0, 0.55, factor_apuntado)
		rotate_y(-event.relative.x * sens)
		pitch = clampf(pitch - event.relative.y * sens, -1.45, 1.45)
	elif event.is_action_pressed("liberar_raton"):
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	elif event is InputEventMouseButton and event.pressed and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
		gatillo_suelto = false # que el clic para recapturar no dispare
	elif event.is_action_pressed("recargar"):
		iniciar_recarga()
	elif event.is_action_pressed("modo_disparo"):
		automatico = not automatico


func _physics_process(delta: float) -> void:
	if not vivo:
		if not is_on_floor():
			velocity.y -= gravedad * delta
		velocity.x = move_toward(velocity.x, 0.0, delta * 10.0)
		velocity.z = move_toward(velocity.z, 0.0, delta * 10.0)
		move_and_slide()
		return
	_actualizar_postura(delta)
	_mover(delta)
	_actualizar_arma(delta)
	_actualizar_camara(delta)


# ---------------------------------------------------------------- Postura

func _actualizar_postura(delta: float) -> void:
	if Input.is_action_pressed("agacharse"):
		agachado = true
	elif agachado and _puede_levantarse():
		agachado = false

	var altura := ALTURA_AGACHADO if agachado else ALTURA_DE_PIE
	_forma.height = move_toward(_forma.height, altura, delta * 4.0)
	colision.position.y = _forma.height * 0.5
	var ojos := OJOS_AGACHADO if agachado else OJOS_DE_PIE
	cabeza.position.y = lerpf(cabeza.position.y, ojos, 1.0 - exp(-12.0 * delta))

	apuntando = Input.is_action_pressed("apuntar") and not recargando
	factor_apuntado = move_toward(factor_apuntado, 1.0 if apuntando else 0.0, delta * 6.0)

	var objetivo := 0.0
	if Input.is_action_pressed("inclinar_izq"):
		objetivo -= 1.0
	if Input.is_action_pressed("inclinar_der"):
		objetivo += 1.0
	if objetivo != 0.0:
		objetivo *= _espacio_para_inclinarse(objetivo)
	inclinacion = move_toward(inclinacion, objetivo, delta * 5.0)


func _puede_levantarse() -> bool:
	return not test_move(global_transform, Vector3.UP * (ALTURA_DE_PIE - _forma.height + 0.05))


## Cuánto se puede inclinar (0..1) sin meter la cabeza en una pared.
func _espacio_para_inclinarse(lado: float) -> float:
	var origen := global_position + Vector3.UP * cabeza.position.y
	var destino := origen + global_basis.x * lado * (INCLINACION_DESPLAZAMIENTO + 0.25)
	var consulta := PhysicsRayQueryParameters3D.create(origen, destino, 1, [get_rid()])
	var res := get_world_3d().direct_space_state.intersect_ray(consulta)
	if res.is_empty():
		return 1.0
	var punto: Vector3 = res["position"]
	return clampf((origen.distance_to(punto) - 0.25) / INCLINACION_DESPLAZAMIENTO, 0.0, 1.0)


# ---------------------------------------------------------------- Movimiento

func _mover(delta: float) -> void:
	if not is_on_floor():
		velocity.y -= gravedad * delta
	elif Input.is_action_just_pressed("saltar") and not agachado:
		velocity.y = fuerza_salto

	var entrada := Input.get_vector("izquierda", "derecha", "adelante", "atras")
	var dir := (global_basis * Vector3(entrada.x, 0.0, entrada.y)).normalized()
	corriendo = Input.is_action_pressed("correr") and entrada.y < -0.1 and not agachado \
		and factor_apuntado < 0.1 and is_on_floor()

	var vel := velocidad_caminar
	if agachado:
		vel = velocidad_agachado
	elif factor_apuntado > 0.5:
		vel = velocidad_apuntando
	elif corriendo:
		vel = velocidad_correr
	if absf(inclinacion) > 0.1:
		vel = minf(vel, velocidad_agachado + 0.5)

	var acel := aceleracion_suelo if is_on_floor() else aceleracion_aire
	var horizontal := Vector3(velocity.x, 0.0, velocity.z).lerp(dir * vel, 1.0 - exp(-acel * delta))
	velocity.x = horizontal.x
	velocity.z = horizontal.z
	move_and_slide()


# ---------------------------------------------------------------- Arma

func _actualizar_arma(delta: float) -> void:
	espera_disparo -= delta
	floracion = move_toward(floracion, 0.0, delta * 4.0)
	retroceso = retroceso.lerp(Vector2.ZERO, 1.0 - exp(-6.0 * delta))
	patada = move_toward(patada, 0.0, delta * 0.4)
	sacudida = move_toward(sacudida, 0.0, delta * 0.1)

	t_fogonazo -= delta
	fogonazo.visible = t_fogonazo > 0.0

	if recargando:
		recarga_restante -= delta
		if recarga_restante <= 0.0:
			_terminar_recarga()

	if not Input.is_action_pressed("disparar"):
		gatillo_suelto = true
	elif Input.mouse_mode == Input.MOUSE_MODE_CAPTURED and not recargando and not corriendo \
			and espera_disparo <= 0.0 and rondas > 0 and (automatico or gatillo_suelto):
		disparar()
		gatillo_suelto = false

	# Posición del arma: cadera / mira, balanceo al caminar, patada y recarga.
	var velocidad_h := Vector2(velocity.x, velocity.z).length()
	if is_on_floor():
		balanceo += delta * velocidad_h * 1.7
	var amplitud := 0.012 * (1.0 - factor_apuntado * 0.85)
	var objetivo := POS_ARMA_CADERA.lerp(POS_ARMA_MIRA, factor_apuntado)
	objetivo += Vector3(sin(balanceo) * amplitud, -absf(cos(balanceo)) * amplitud, patada)
	var giro := Vector3.ZERO
	if corriendo:
		objetivo += Vector3(-0.06, -0.06, 0.04)
		giro = Vector3(0.0, 0.6, 0.25)
	if recargando:
		objetivo += Vector3(0.0, -0.12, 0.0)
		giro = Vector3(0.55, 0.0, 0.35)
	arma.position = arma.position.lerp(objetivo, 1.0 - exp(-18.0 * delta))
	arma.rotation = arma.rotation.lerp(giro, 1.0 - exp(-10.0 * delta))


func disparar() -> void:
	rondas -= 1
	espera_disparo = 60.0 / cadencia_rpm

	var origen := camara.global_position
	var dir := Util.desviar(-camara.global_basis.z, dispersion_actual())
	var consulta := PhysicsRayQueryParameters3D.create(origen, origen + dir * alcance, MASCARA_DISPARO, [get_rid()])
	var res := get_world_3d().direct_space_state.intersect_ray(consulta)
	if not res.is_empty():
		var objetivo: Object = res["collider"]
		var punto: Vector3 = res["position"]
		if objetivo.has_method("recibir_impacto"):
			var zona := Util.zona_de_impacto(objetivo, res["shape"])
			var caida := clampf(1.0 - origen.distance_to(punto) / 400.0, 0.6, 1.0)
			var mortal: bool = objetivo.recibir_impacto(dano_base * caida, zona, punto, dir, self)
			get_tree().call_group("hud", "marcar_impacto", mortal)
		else:
			get_tree().call_group("nivel", "crear_marca", punto, res["normal"])

	# Retroceso: una parte sube la mira de verdad (hay que compensar con el ratón)
	# y otra es visual y se recupera sola.
	var control := lerpf(1.0, 0.55, factor_apuntado) * (0.7 if agachado else 1.0)
	var subida := randf_range(0.010, 0.016) * control
	pitch = clampf(pitch + subida * 0.4, -1.45, 1.45)
	retroceso.x += subida * 0.6
	retroceso.y += randf_range(-0.006, 0.006) * control
	floracion = minf(floracion + 0.7, 6.0)
	patada = 0.05
	t_fogonazo = 0.05

	get_tree().call_group("enemigos", "oir_disparo", global_position)


## Dispersión actual del arma en grados (también la usa la mira del HUD).
func dispersion_actual() -> float:
	var velocidad_h := Vector2(velocity.x, velocity.z).length()
	var d := lerpf(2.5, 0.25, factor_apuntado)
	d += velocidad_h / velocidad_correr * lerpf(4.0, 2.0, factor_apuntado)
	d += floracion * lerpf(1.0, 0.5, factor_apuntado)
	if not is_on_floor():
		d += 6.0
	if agachado:
		d *= 0.65
	return d


func iniciar_recarga() -> void:
	if recargando or cargadores.is_empty() or rondas > capacidad_cargador:
		return
	recargando = true
	recarga_restante = tiempo_recarga if rondas > 0 else tiempo_recarga_vacio


## Recarga táctica: el cargador que sacas se guarda con las balas que le queden
## y, si había bala en la recámara, se conserva (30 + 1).
func _terminar_recarga() -> void:
	recargando = false
	var en_recamara := 1 if rondas > 0 else 0
	var sobrante := rondas - en_recamara
	if sobrante > 0:
		cargadores.append(sobrante)
	cargadores.sort()
	var nuevo: int = cargadores.pop_back()
	rondas = nuevo + en_recamara


# ---------------------------------------------------------------- Cámara y daño

func _actualizar_camara(_delta: float) -> void:
	cabeza.rotation = Vector3(pitch, 0.0, -inclinacion * INCLINACION_ANGULO)
	cabeza.position.x = inclinacion * INCLINACION_DESPLAZAMIENTO
	var temblor := Vector2(randf_range(-1.0, 1.0), randf_range(-1.0, 1.0)) * sacudida
	camara.rotation = Vector3(retroceso.x + temblor.x, retroceso.y + temblor.y, 0.0)
	camara.fov = lerpf(FOV_NORMAL, FOV_MIRA, factor_apuntado)


func punto_cabeza() -> Vector3:
	return camara.global_position


func recibir_impacto(dano: float, _zona: String, _punto: Vector3, _dir: Vector3, _atacante: Node3D) -> bool:
	if not vivo:
		return false
	vida -= dano
	retroceso.x += 0.025
	sacudida = maxf(sacudida, 0.015)
	get_tree().call_group("hud", "recibir_dano")
	if vida <= 0.0:
		vida = 0.0
		_morir()
		return true
	return false


## Una bala pasó cerca: tiembla la vista y cuesta más apuntar.
func supresion(intensidad: float) -> void:
	if not vivo:
		return
	floracion = minf(floracion + 1.5 * intensidad, 6.0)
	sacudida = maxf(sacudida, 0.012 * intensidad)


func _morir() -> void:
	vivo = false
	recargando = false
	fogonazo.visible = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	var tween := create_tween().set_parallel()
	tween.tween_property(cabeza, "position", Vector3(0.0, 0.3, 0.0), 0.6)
	tween.tween_property(cabeza, "rotation:z", 1.2, 0.6)
	tween.tween_property(arma, "position:y", -0.8, 0.5)
	murio.emit()
