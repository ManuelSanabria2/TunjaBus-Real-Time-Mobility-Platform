# Política de Tratamiento y Retención de Datos — TunjaBus ("Andén")

**Última actualización:** 19 de julio de 2026
**Responsable del tratamiento:** _[Nombre / razón social del operador de la plataforma]_ · _[correo de contacto]_ · Tunja, Boyacá, Colombia

Esta política describe qué datos almacena la plataforma Andén (seguimiento de
transporte público de Tunja), por cuánto tiempo, con qué finalidad y bajo qué
fundamento, en cumplimiento del régimen colombiano de protección de datos
personales (habeas data): **Ley 1581 de 2012**, **Decreto 1377 de 2013** y
demás normas concordantes, y de sus principios de **finalidad, necesidad,
temporalidad y seguridad**.

---

## 1. Qué datos se almacenan y por cuánto tiempo

| Dato | Dónde | Retención | Finalidad |
|---|---|---|---|
| Posiciones GPS de vehículos (lat/lon, velocidad, rumbo, hora) | `vehicle_positions` | **60 días**, luego se resumen y se eliminan (ver §2) | Mostrar buses en tiempo real a los pasajeros; calcular ETAs; reportes operativos |
| Resúmenes diarios por vehículo (km recorridos, % de operación, velocidad promedio) | `daily_stats` | Indefinida (dato **agregado**, sin trazas punto a punto) | Reportes históricos e institucionales sin conservar trayectorias detalladas |
| Identificación de vehículos (label anónimo tipo "BUS-001", ruta) | `vehicles` | Mientras el vehículo esté registrado | Operación del sistema |
| Credencial del vehículo | `vehicles.token_hash` | Mientras el vehículo esté registrado | Autenticación de escritura. **Solo se guarda el hash SHA-256**; el token en claro nunca se almacena |
| Datos de cooperativas (nombre, correo y teléfono de contacto corporativo) | `operators` | Mientras exista la relación | Gestión del servicio y notificación de alertas |
| Cuentas del panel administrativo (correo electrónico) | Supabase Auth, `operator_members`, `authority_users` | Mientras la cuenta esté activa | Acceso por roles al panel de gestión |
| Alertas operativas (vehículo, tipo, fechas) | `alerts` | Histórico operativo | Supervisión del servicio |
| Registro de intentos fallidos de autenticación (motivo, IP de origen) | `auth_failures` | **30 días** (poda automática) | Seguridad: detección de abuso |

**Lo que NO se almacena:** nombres, cédulas o teléfonos de conductores; cuentas
o perfiles de pasajeros (la app de pasajeros funciona sin registro y no envía
la ubicación del usuario al servidor — se usa solo localmente en su
dispositivo); tokens de vehículo en texto plano; contraseñas en claro
(gestionadas por Supabase Auth con hash).

## 2. Ciclo de vida de las posiciones GPS (retención de 60 días)

1. Cada noche (03:30 hora local), un proceso automático **agrega** los días
   completos a `daily_stats`: kilómetros recorridos, minutos de operación
   dentro del horario de la ruta, % de disponibilidad y velocidad promedio,
   por vehículo y día.
2. Acto seguido, **elimina** las posiciones con más de **60 días** de
   antigüedad. Por diseño, solo se eliminan días que ya fueron resumidos.
3. El resultado: el detalle punto a punto existe como máximo 60 días; el
   histórico de largo plazo se conserva únicamente en forma **agregada**, de
   la cual no es posible reconstruir trayectorias.

**Por qué 60 días:** es el plazo necesario para reportes operativos recientes,
auditoría de alertas y verificación de cobertura (finalidades del §1), y a la
vez aplica el principio de temporalidad de la Ley 1581: los datos no se
conservan más tiempo del necesario para su finalidad.

## 3. Naturaleza de los datos de posición

Las posiciones GPS pertenecen a **vehículos**, identificados con etiquetas
anónimas, no a personas. No obstante, durante un turno una trayectoria podría
asociarse indirectamente al conductor asignado. Por prudencia, la plataforma
las trata con criterios de minimización propios de datos personales:
retención corta (60 días), agregación posterior, acceso de gestión restringido
por roles y ausencia total de identificadores personales del conductor en el
sistema.

## 4. Derechos de los titulares (habeas data)

Cualquier titular (por ejemplo, un conductor que considere que una trayectoria
le concierne, o el personal de contacto de una cooperativa) puede ejercer los
derechos de la Ley 1581: **conocer, actualizar, rectificar y suprimir** sus
datos, y **revocar la autorización**, escribiendo a _[correo de contacto]_.
Plazos de respuesta: consultas, 10 días hábiles; reclamos, 15 días hábiles
(arts. 14 y 15, Ley 1581 de 2012).

## 5. Medidas de seguridad

- **Escritura autenticada:** solo un vehículo con token válido puede reportar
  posición, vía función de servidor; la escritura directa está bloqueada
  (Row Level Security). El token se verifica contra su hash SHA-256.
- **Acceso por roles:** cada cooperativa gestiona únicamente sus datos; la
  Secretaría de Movilidad tiene acceso institucional de solo lectura. Aplicado
  a nivel de base de datos (RLS), no solo de interfaz.
- **Limitación de tasa** de reportes por vehículo y **registro de intentos
  fallidos** con poda a 30 días.
- **Cifrado en tránsito** (HTTPS/TLS) en todos los componentes.
- Los datos públicos de la app de pasajeros (posiciones en vivo, rutas,
  paraderos) no contienen datos personales.

## 6. Cambios a esta política

Los cambios se versionan en este archivo dentro del repositorio del proyecto y
rigen desde su publicación. Los mecanismos técnicos que implementan esta
política están en `backend/supabase/migrations/` (migraciones 001–007).
