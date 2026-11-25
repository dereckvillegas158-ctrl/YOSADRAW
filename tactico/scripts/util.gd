class_name Util
## Funciones de ayuda compartidas.


## Desvía una dirección al azar dentro de un cono de `grados` (balística con dispersión).
static func desviar(dir: Vector3, grados: float) -> Vector3:
	if grados <= 0.0:
		return dir
	var perpendicular := dir.cross(Vector3.UP)
	if perpendicular.length_squared() < 0.001:
		perpendicular = dir.cross(Vector3.RIGHT)
	perpendicular = perpendicular.normalized().rotated(dir, randf() * TAU)
	# randf() sin raíz concentra los impactos hacia el centro, como un arma real.
	return dir.rotated(perpendicular, deg_to_rad(grados) * randf()).normalized()


## Nombre del nodo CollisionShape3D que recibió el impacto ("Cabeza", "Cuerpo"...).
static func zona_de_impacto(cuerpo: Object, indice_forma: int) -> String:
	var objeto := cuerpo as CollisionObject3D
	if objeto == null:
		return "Cuerpo"
	var dueno := objeto.shape_find_owner(indice_forma)
	var nodo := objeto.shape_owner_get_owner(dueno) as Node
	return String(nodo.name) if nodo else "Cuerpo"
