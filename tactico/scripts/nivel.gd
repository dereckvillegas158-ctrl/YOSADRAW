class_name Nivel
extends Node3D
## Construye el mapa de prueba con bloques simples (ligero y fácil de editar),
## hornea la navegación para la IA, coloca a los enemigos y controla la partida.
## Para hacer tu propio mapa puedes cambiar `_construir()` o diseñarlo a mano
## en el editor dentro del nodo Navegacion.

const RUTA_ENEMIGO := "res://escenas/enemigo.tscn"
const MAX_MARCAS := 80

const GRIS := Color(0.42, 0.42, 0.4)
const HORMIGON := Color(0.62, 0.6, 0.55)
const ARENA := Color(0.58, 0.52, 0.38)
const MADERA := Color(0.5, 0.36, 0.2)
const OXIDO := Color(0.52, 0.22, 0.15)
const AZUL := Color(0.16, 0.3, 0.48)
const VERDE := Color(0.22, 0.38, 0.25)

## Rutas de patrulla: el primer punto es donde aparece cada enemigo.
const PATRULLAS := [
	[Vector3(-2, 0, -3), Vector3(2, 0, 3)],
	[Vector3(-14, 0, -20), Vector3(-24, 0, -2)],
	[Vector3(17, 0, -19), Vector3(25, 0, 2)],
	[Vector3(-12, 0, -30), Vector3(12, 0, -30)],
	[Vector3(-22, 0, 12), Vector3(-14, 0, 13)],
	[Vector3(22, 0, 14), Vector3(12, 0, 4)],
]

var puntos_cobertura: Array[Vector3] = []
var enemigos_restantes := 0
var tiempo := 0.0
var terminado := false

var _materiales := {}
var _malla_marca: BoxMesh
var _marcas: Array[Node3D] = []

@onready var navegacion: NavigationRegion3D = $Navegacion
@onready var jugador: Jugador = get_tree().get_first_node_in_group("jugador")


func _ready() -> void:
	add_to_group("nivel")
	var sol := get_parent().get_node_or_null("Sol") as DirectionalLight3D
	if sol:
		sol.rotation_degrees = Vector3(-55.0, 40.0, 0.0)

	_malla_marca = BoxMesh.new()
	_malla_marca.size = Vector3(0.07, 0.07, 0.01)
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.08, 0.07, 0.06)
	_malla_marca.material = mat

	_construir()
	navegacion.bake_navigation_mesh(false)
	_generar_enemigos()
	jugador.murio.connect(_al_morir_jugador)


func _process(delta: float) -> void:
	if not terminado:
		tiempo += delta


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("reiniciar"):
		get_tree().reload_current_scene()


# ---------------------------------------------------------------- Mapa

func _construir() -> void:
	# Suelo y muros perimetrales
	_bloque(Vector3(0, -0.5, 0), Vector3(66, 1, 66), GRIS)
	_bloque(Vector3(0, 2, -33), Vector3(66, 4, 1), HORMIGON)
	_bloque(Vector3(0, 2, 33), Vector3(66, 4, 1), HORMIGON)
	_bloque(Vector3(-33, 2, 0), Vector3(1, 4, 66), HORMIGON)
	_bloque(Vector3(33, 2, 0), Vector3(1, 4, 66), HORMIGON)

	# Edificio central con puertas al norte, sur y este
	for z in [-6.0, 6.0]:
		_bloque(Vector3(-3.4, 1.6, z), Vector3(5.2, 3.2, 0.3), HORMIGON, true)
		_bloque(Vector3(3.4, 1.6, z), Vector3(5.2, 3.2, 0.3), HORMIGON, true)
	_bloque(Vector3(-6, 1.6, 0), Vector3(0.3, 3.2, 12.3), HORMIGON, true)
	_bloque(Vector3(6, 1.6, -3.4), Vector3(0.3, 3.2, 5.2), HORMIGON, true)
	_bloque(Vector3(6, 1.6, 3.4), Vector3(0.3, 3.2, 5.2), HORMIGON, true)
	_bloque(Vector3(-3.5, 0.6, -3.5), Vector3(1.2, 1.2, 1.2), MADERA)
	_bloque(Vector3(3.5, 0.6, 3.5), Vector3(1.2, 1.2, 1.2), MADERA)

	# Contenedores
	_bloque(Vector3(-17, 1.3, -10), Vector3(2.4, 2.6, 6), OXIDO, true)
	_bloque(Vector3(-17, 3.9, -10), Vector3(2.4, 2.6, 6), AZUL)
	_bloque(Vector3(17, 1.3, 9), Vector3(6, 2.6, 2.4), VERDE, true)
	_bloque(Vector3(14, 1.3, -14), Vector3(2.4, 2.6, 6), AZUL, true)
	_bloque(Vector3(-12, 1.3, 21), Vector3(6, 2.6, 2.4), VERDE, true)
	_bloque(Vector3(24, 1.3, 22), Vector3(6, 2.6, 2.4), OXIDO, true)
	_bloque(Vector3(-25, 1.3, -24), Vector3(6, 2.6, 2.4), VERDE, true)

	# Muros bajos de sacos (cubren si te agachas)
	_bloque(Vector3(-7, 0.55, 15), Vector3(4, 1.1, 0.5), ARENA)
	_bloque(Vector3(7, 0.55, 15), Vector3(4, 1.1, 0.5), ARENA)
	_bloque(Vector3(0, 0.55, 20), Vector3(3, 1.1, 0.5), ARENA)
	_bloque(Vector3(-22, 0.55, 3), Vector3(0.5, 1.1, 4), ARENA)
	_bloque(Vector3(22, 0.55, -3), Vector3(0.5, 1.1, 4), ARENA)
	_bloque(Vector3(-8, 0.55, -18), Vector3(4, 1.1, 0.5), ARENA)
	_bloque(Vector3(9, 0.55, -22), Vector3(4, 1.1, 0.5), ARENA)
	_bloque(Vector3(0, 0.55, -12), Vector3(5, 1.1, 0.5), ARENA)

	# Muros altos sueltos
	_bloque(Vector3(12, 1.5, -6), Vector3(4, 3, 0.4), HORMIGON, true)
	_bloque(Vector3(-12, 1.5, 6), Vector3(0.4, 3, 4), HORMIGON, true)
	_bloque(Vector3(20, 1.5, -26), Vector3(4, 3, 0.4), HORMIGON, true)
	_bloque(Vector3(-25, 1.5, -15), Vector3(0.4, 3, 4), HORMIGON, true)

	# Cobertura en la zona de inicio del jugador
	_bloque(Vector3(0, 1.5, 24.5), Vector3(7, 3, 0.4), HORMIGON, true)
	_bloque(Vector3(-6, 1.3, 27.5), Vector3(2.4, 2.6, 5), AZUL, true)
	_bloque(Vector3(6, 0.55, 27), Vector3(0.5, 1.1, 3), ARENA)

	# Cajas
	for p: Vector3 in [
		Vector3(-4, 0.6, 10), Vector3(-2.8, 0.6, 10), Vector3(10, 0.6, 2), Vector3(10, 0.6, 3.2),
		Vector3(-10, 0.6, -4), Vector3(20, 0.6, 17), Vector3(-20, 0.6, 18), Vector3(5, 0.6, -26),
		Vector3(-5, 0.6, -28), Vector3(26, 0.6, -14), Vector3(-27, 0.6, -8),
	]:
		_bloque(p, Vector3(1.2, 1.2, 1.2), MADERA)
	_bloque(Vector3(-3.4, 1.8, 10), Vector3(1.2, 1.2, 1.2), MADERA)


## Crea un bloque sólido. Si `cobertura` es true, añade puntos de cobertura
## alrededor para que la IA pueda esconderse detrás.
func _bloque(pos: Vector3, tam: Vector3, color: Color, cobertura := false) -> StaticBody3D:
	var cuerpo := StaticBody3D.new()
	cuerpo.position = pos
	var malla := MeshInstance3D.new()
	var caja := BoxMesh.new()
	caja.size = tam
	caja.material = _material(color)
	malla.mesh = caja
	cuerpo.add_child(malla)
	var forma := CollisionShape3D.new()
	var caja_forma := BoxShape3D.new()
	caja_forma.size = tam
	forma.shape = caja_forma
	cuerpo.add_child(forma)
	navegacion.add_child(cuerpo)

	if cobertura:
		var margen := 0.8
		for offset: Vector3 in [
			Vector3(tam.x * 0.5 + margen, 0, 0), Vector3(-tam.x * 0.5 - margen, 0, 0),
			Vector3(0, 0, tam.z * 0.5 + margen), Vector3(0, 0, -tam.z * 0.5 - margen),
		]:
			var punto := Vector3(pos.x, 0.0, pos.z) + offset
			if absf(punto.x) < 31.5 and absf(punto.z) < 31.5:
				puntos_cobertura.append(punto)
	return cuerpo


func _material(color: Color) -> StandardMaterial3D:
	if not _materiales.has(color):
		var mat := StandardMaterial3D.new()
		mat.albedo_color = color
		mat.roughness = 0.9
		_materiales[color] = mat
	return _materiales[color]


# ---------------------------------------------------------------- Partida

func _generar_enemigos() -> void:
	var escena_enemigo: PackedScene = load(RUTA_ENEMIGO)
	for ruta_datos: Array in PATRULLAS:
		var enemigo: Enemigo = escena_enemigo.instantiate()
		var ruta: Array[Vector3] = []
		for p: Vector3 in ruta_datos:
			ruta.append(p)
		enemigo.ruta = ruta
		enemigo.nivel = self
		enemigo.position = ruta[0]
		enemigo.murio.connect(_al_morir_enemigo)
		add_child(enemigo)
		enemigos_restantes += 1


func _al_morir_enemigo() -> void:
	enemigos_restantes -= 1
	if enemigos_restantes <= 0 and jugador.vivo:
		terminado = true
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		get_tree().call_group("hud", "mostrar_mensaje",
			"ZONA DESPEJADA\nTiempo: %d:%02d   Vida: %d\n\nEnter para jugar otra vez" % [
				int(tiempo) / 60, int(tiempo) % 60, int(jugador.vida)])


func _al_morir_jugador() -> void:
	terminado = true
	get_tree().call_group("hud", "mostrar_mensaje",
		"HAS CAÍDO\nEnemigos restantes: %d\n\nEnter para reintentar" % enemigos_restantes)


## Deja una marca de bala en una superficie.
func crear_marca(punto: Vector3, normal: Vector3) -> void:
	var marca := MeshInstance3D.new()
	marca.mesh = _malla_marca
	marca.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(marca)
	var arriba := Vector3.UP if absf(normal.dot(Vector3.UP)) < 0.99 else Vector3.RIGHT
	marca.look_at_from_position(punto + normal * 0.006, punto + normal, arriba)
	_marcas.append(marca)
	if _marcas.size() > MAX_MARCAS:
		_marcas.pop_front().queue_free()
