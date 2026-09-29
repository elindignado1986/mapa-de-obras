# Explorador de Obras — implementación y puesta en marcha

Esta evolución se implementó en `E:\Nueva carpeta\mapa-de-sombras_v2`. La versión anterior no se modificó. El Explorador es la entrada principal; `/#simulador` y los enlaces `#v1=...` abren el simulador existente. No se desplegó en producción.

## Qué funciona

- Navegación entre Explorador y Simulador, conservando la simulación al cambiar de sección. Una obra pública se copia al simulador mediante «Probar otra altura».
- Mapa de obras, filtros por municipio/localidad y estado de permiso, fichas con fuentes, URL permanente `/?obra=UUID` y paginación. Sin Redis, se informa que el registro no está configurado; no se presenta un registro vacío ficticio.
- Cámara mediante el selector nativo `capture="environment"` en móviles compatibles y carga de archivo alternativa. Vista previa, reemplazo y cancelación antes de enviar. JPG/PNG/WebP, hasta 12 MB y 24 megapíxeles de entrada; salida JPEG de hasta 3 MB. Las imágenes se recodifican en navegador y servidor; no se conservan EXIF.
- Lectura real de QR mediante BarcodeDetector cuando existe y ZXing como alternativa, con zonas superpuestas para carteles con varios QR. Permite elegir entre enlaces o pegar uno. Los enlaces que no sean HTTPS no se consultan.
- OCR opcional real en el navegador con Tesseract y modelo español servidos desde el mismo sitio. No requiere claves ni envía la foto a un proveedor de OCR. El texto queda como información no verificada y privada; no se convierte automáticamente en datos del permiso.
- Aportes privados en Redis, foto en Blob privado, recuperación mediante una clave aleatoria del navegador, revisiones e historial. `localStorage` conserva únicamente las claves para retomar aportes; las obras y los aportes se consultan al servidor. La lista «Mis aportes guardados» permite retomar varios. Borrar el almacenamiento del navegador elimina esas claves, no los registros del servidor.
- Cola durable en Redis y worker externo para consultar permisos. Los trabajos no dependen de una petición HTTP abierta ni de que el navegador continúe abierto.
- Selección/corrección de hasta 16 parcelas contiguas; terreno 3D durante la confirmación. Los identificadores del permiso se buscan primero en un índice catastral propio, independiente del geocodificador; la dirección permanece visible para contrastarla. Si no hay identificación disponible, la búsqueda de domicilio sirve solo como propuesta. El servidor carga las geometrías del catastro propio, ignorando cualquier geometría enviada por el cliente. Los identificadores de un permiso deben coincidir con la selección antes de publicar.
- Volumen prismático con altura y huella documentadas cuando existe una huella simple compatible; de otro modo extrusión de la parcela completa, explícitamente aproximada. Pisos no se convierten silenciosamente a altura oficial. Faltantes se muestran como «No disponible».
- Publicación mediante confirmación explícita, validación en servidor y transacción Lua con revisión e índices únicos. Solo se muestra éxito tras confirmar el guardado. Se conserva la ficha anterior; una foto o extracción nueva se registra como aporte separado.
- Duplicados fuertes por QR y municipio + permiso/expediente. Parcelas y dirección generan candidatos secundarios, sin impedir que existan permisos distintos sobre el mismo lote.

## Configuración necesaria

| Variable / servicio | Uso |
| --- | --- |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Redis REST del proyecto, con permisos de escritura y EVAL. Se reutilizan las variables Vercel KV/Upstash existentes. |
| `BLOB_READ_WRITE_TOKEN` | Almacén **privado** de Vercel Blob. Las fotos públicas se sirven mediante la API solo después de la revisión. |
| `WORKS_ORIGIN` | Origen permitido para escrituras, por ejemplo `http://localhost:4173` en desarrollo. En producción, si se omite, se exige HTTPS y el mismo host. |
| `WORKS_DATA_ORIGIN` | Origen HTTPS propio que sirve `/data/amba/`. Necesario en Vercel para verificar parcelas sin incluir los 206 MB de catastro en la función. Vacío en local: lectura de archivos. No acepta un origen enviado por el visitante. |
| `WORKS_PERMIT_HOSTS` | Lista separada por comas de hosts municipales exactos revisados. Vacía por defecto. Cada redirección se verifica nuevamente. |
| Worker persistente | Un proceso externo ejecutando `npm run works:worker`, con las mismas credenciales Redis. No se inicia automáticamente en Vercel. |

Las variables `KV_REST_API_READ_ONLY_TOKEN`, `KV_REST_API_KV_URL` y `KV_REST_API_REDIS_URL` no sirven para este flujo de escritura REST y no se incluyen en el cliente. No se leyó ni alteró la configuración remota del proyecto.

Si la integración se conectó con prefijo personalizado `kv` o `KV`, el registro también reconoce los pares `kv_KV_REST_API_URL` / `kv_KV_REST_API_TOKEN` y `KV_KV_REST_API_URL` / `KV_KV_REST_API_TOKEN`. El prefijo se agrega a los nombres originales; no los reemplaza. Se prioriza el par sin prefijo si ambos están configurados y nunca se mezclan credenciales de pares distintos. No hace falta copiar ni revelar secretos para usar la conexión existente. Este reconocimiento se aplica al registro de obras y su worker.

Referencias consultadas: [Redis REST y Lua de Upstash](https://upstash.com/docs/redis/features/restapi), [SDK de Vercel Blob](https://vercel.com/docs/vercel-blob/using-blob-sdk) y [almacenamiento privado](https://vercel.com/docs/vercel-blob/private-storage). La integración implementada usa estos protocolos, pero todavía no fue validada contra las cuentas reales de este proyecto.

## Desarrollo local

```powershell
npm.cmd ci
npm.cmd run build
# Copiar .env.example a .env y completar credenciales fuera de Git.
node --env-file=.env scripts/serve.cjs publicar
# En otra terminal, si se quiere procesar la cola:
node --env-file=.env scripts/works-worker.cjs
```

Sin `.env`, `npm.cmd run dev` permite usar el Explorador, leer fotos/QR/OCR y usar el Simulador. El envío y la publicación informan la falta de configuración. El servidor local ahora incluye las rutas `/api/works` y `/api/works-photo`; reiniciar procesos anteriores para habilitarlas.

## Formatos municipales y revisión

### Alternativa cuando el QR no funciona

«Leer cartel» lee el texto por defecto y activa la alternativa cuando no reconoce un QR HTTPS. El botón «El QR no funciona: leer el texto del cartel» permite continuar si el código es legible pero su enlace está caído, vencido o inaccesible. El aportante puede revisar y corregir el texto reconocido y actualizar los campos antes de enviar. También puede retomar una foto privada guardada para leerla nuevamente.

La extracción local y del servidor (`server/works/sign-text.cjs`) busca rótulos de municipio, localidad, dirección, permiso, expediente, altura explícita en metros, pisos, superficies con unidades, responsables y fechas. Conserva evidencia textual por campo, el texto completo y advertencias por números ambiguos o contradictorios. FOT/FOS/densidad solo se clasifican si el cartel distingue proyecto y normativa. Nomenclatura catastral se conserva como texto a revisar, sin tratarla automáticamente como un identificador parcelario canónico. El texto de contacto y otros datos personales no se convierten en campos de la ficha.

Los resultados se guardan en `signExtraction`, separados de `extracted` (permiso). `sign-ocr` identifica lectura automática y `user-transcribed` identifica texto corregido por el aportante. Ninguno habilita publicación automática ni sobrescribe datos documentados. La dirección propuesta sirve para asistir la confirmación manual, no para verificar el inmueble. No se convierte cantidad de pisos a altura oficial.

El modo de solo texto guarda inmediatamente un aporte `review-required` sin encolarlo ni requerir worker: la lectura OCR se ejecuta en el navegador y el servidor vuelve a extraer los campos del texto recibido. Si se consulta el QR y el worker falla, conserva la alternativa textual. Los formatos sin rótulos reconocibles permanecen en el texto para revisión manual; no se garantiza extraer todos los carteles. Pruebas adicionales: `node scripts/check-sign-text.cjs` ejecuta OCR real sobre un cartel sintético sin QR, corrección, guardado mediante API simulada, recuperación y vista móvil. Aún falta validación con la foto real del usuario.

**Municipios verificados con permisos reales: ninguno.** No se recibieron fotos ni enlaces municipales de muestra durante esta implementación. No se afirma compatibilidad automática con ningún municipio. Los cinco municipios/localidades del simulador continúan habilitados como antes.

`server/works/permit.cjs` contiene el límite de confianza y un adaptador de contrato JSON `mapa-permiso-v1`. No es un formato municipal real ni una integración productiva simulada. Permite validar el modelo de datos y conectar futuros adaptadores. Las respuestas HTML/PDF, sitios privados, formatos desconocidos, errores y contradicciones quedan pendientes. No se extraen valores mediante heurísticas que puedan confundir normativa con proyecto.

Para revisar un aporte mientras se implementan adaptadores reales, un operador con acceso al servidor puede leer el permiso público, preparar el JSON normalizado y ejecutar:

```powershell
node --env-file=.env scripts/review-work.cjs UUID permiso-revisado.json --confirm-source-reviewed
# Agregar --confirm-photo-reviewed únicamente después de revisar que la foto
# no exponga información personal ajena a la identificación pública de la obra.
```

Este comando **no publica**. Conserva la revisión anterior y habilita la continuación del aportante, quien debe confirmar ubicación y visibilidad pública. Las incorporaciones adicionales a obras ya publicadas permanecen separadas para revisión: no existe fusión automática de sus datos ni una interfaz administrativa de edición pública.

Ejemplo de contrato para pruebas o revisión (datos deliberadamente sintéticos):

```json
{
  "schema": "mapa-permiso-v1",
  "fields": {
    "municipality": "tres-de-febrero",
    "locality": "Localidad de ejemplo",
    "address": "Dirección de ejemplo 123",
    "permit": "EJEMPLO-123",
    "height": 27,
    "floors": 8,
    "permitStatus": "Estado transcripto de la fuente",
    "coveredArea": 150,
    "totalArea": 200,
    "projectFOT": 1.2,
    "allowedFOT": 2,
    "permitDate": "2026-09-01"
  },
  "parcelIds": [],
  "documents": []
}
```

Los campos permitidos y sus unidades están en `FIELDS` de `server/works/permit.cjs`: alturas en metros, superficies en m², FOT/FOS en m²/m² y densidades en hab/ha. No usar este contrato para convertir una altura estimada en oficial. La huella opcional se recibe en `footprint` como GeoJSON Polygon cerrado, EPSG:4326, un solo anillo simple, hasta 1000 vértices y contenido dentro de las parcelas. MultiPolygon, patios y alturas variables necesitan un adaptador adicional y quedan para revisión. Los documentos asociados se guardan como enlaces públicos, no se descargan ni ejecutan.

Cada adaptador municipal futuro deberá conservar fuente, fecha y conceptos, registrar contradicciones y pasar pruebas con permisos reales antes de habilitar una política de verificación automática. Actualmente toda extracción necesita revisión de operador: la bandera `verified` nunca se acepta desde la API pública.

## Seguridad, estados y persistencia

- Estados: `pending`, `queued`, `processing`, `extracted`, `location-confirmed`, `review-required`, `published`. La confirmación de ubicación no verifica el permiso. El frontend consulta el estado periódicamente mientras hay un trabajo visible y pendiente.
- Claves Redis aisladas en `works:v1:`: `job`, `history`, `public`, `public-index`, `queue`, `unique`, `candidate`, `rate`. La integración comunitaria anterior conserva su espacio `amba:`. No hay migración destructiva ni importación de simulaciones locales al registro público.
- La cola usa un arrendamiento de dos minutos para recuperar trabajos interrumpidos. El guardado usa comparación de revisión; un worker o reintento atrasado no pisa una edición más reciente.
- Publicación e índices únicos se escriben en una sola operación Lua. Las coincidencias secundarias usan conjuntos y no son claves únicas.
- Fotos privadas separadas de Redis; las anteriores permanecen referenciadas en historial. Retención y moderación requieren una política operativa antes de apertura masiva. No se incluyó un borrado automático de historia.
- QR no confiables: solo HTTPS, hosts exactos configurados, sin credenciales, puertos alternativos ni IP literal. DNS se valida y se fija a la conexión TLS. Se rechazan redes privadas y rangos especiales; IPv6 se rechaza conservadoramente. Hasta tres redirecciones, 10 s por descarga y 1 MB por documento, sin cookies ni ejecución de scripts.
- Límites de tamaño de cargas, 30 escrituras/minuto por identificador efímero derivado de IP. No se guarda la IP cruda. La mitigación no reemplaza protección operativa contra abuso.
- Foto pendiente: únicamente con clave del aporte. Foto pública: solo si el operador la revisó. Texto OCR, claves de recuperación y datos arbitrarios del visitante no salen en la ficha pública.
- Ningún envío por WhatsApp, correo u otros canales se realiza automáticamente. Se preservan las funciones de compartir del simulador.

## Comprobaciones realizadas

```powershell
npm.cmd test
npm.cmd run build
# Con servidor local iniciado:
$env:TEST_ORIGIN='http://localhost:4174' # usar el puerto activo
npm.cmd run test:browser
npm.cmd run test:works:browser
```

- 24 pruebas de Node: geometría, sombras, compartir, comunidad, extracción/procedencia, faltantes y contradicciones, validación de destinos, parcelas originales, requisitos de publicación, duplicados, reintentos y errores.
- Regresión del simulador en Chrome de escritorio y móvil emulado: parcelas contiguas, búsqueda propuesta, giro centrado, altura, enlaces, guardar/compartir y conservación de logo/Cafecito/Instagram y cobertura.
- Explorador en Chrome: entrada, navegación, selector de cámara y alternativa, imagen inválida, QR único/múltiple/ilegible, cancelación, doble clic, aporte pendiente, recarga, corrección parcelaria y terreno 3D, consentimiento, fallo de guardado, enlace permanente en otro contexto de navegador, copia de altura y desbordamiento móvil.
- OCR español ejecutado localmente con un cartel sintético de texto. Las capturas y los resultados quedan en `.checks/`.

**Alcance de la evidencia:** QR y OCR procesaron imágenes sintéticas reales; las pruebas de interacción de publicación usan una API simulada compartida por dos contextos de navegador. Las pruebas de persistencia/errores del backend simulan respuestas REST. Esto **no acredita** funcionamiento de una cuenta real de Upstash/Blob, exactitud de un permiso municipal, simultaneidad bajo carga real ni cámara física de un teléfono. Esas comprobaciones están pendientes de credenciales, despliegue de prueba y ejemplos reales.

## Despliegue pendiente

1. Preparar un entorno de prueba con Redis y Blob privado. Configurar orígenes; no exponer secretos al bundle.
2. Mantener los datasets estáticos propios y configurar `WORKS_DATA_ORIGIN` para que el servidor compruebe parcelas. El build genera el módulo de geometría del servidor, el índice `data/works-index/` por versión de catastro y copia OCR/modelo al sitio. Si se reemplaza un dataset conservando indebidamente su versión, regenerar también su índice; el flujo normal usa versiones nuevas.
3. Desplegar el worker separado con las mismas credenciales. `node scripts/works-worker.cjs --once` permite procesar un trabajo durante diagnóstico.
4. Aportar permisos reales de los primeros municipios, construir/verificar sus adaptadores y revisar las fotos.
5. Probar la publicación real en dos navegadores, reintentos simultáneos, fallos de Blob/Redis, reinicio de worker y cámara de Android/iPhone.
6. Publicar en producción únicamente cuando lo autorice el usuario. La revisión de redistribución ARBA documentada por el proyecto continúa aplicando.
