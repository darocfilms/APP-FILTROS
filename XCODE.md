# Laboratorio en Xcode

La carpeta `ios/` es un proyecto de Xcode completo: la app nativa con la app web
dentro. **No hace falta Node ni terminal** — se descarga, se abre y se le da a ▶.

## Qué necesitas

- **Un Mac con Xcode**, la versión actual de la App Store del Mac (26 o
  posterior). Xcode sólo existe para Mac.
- **Tu iPhone** con iOS 15 o posterior, y un cable.
- **Un Apple ID.** Gratis para instalarla en tu propio iPhone. Para TestFlight o
  App Store hace falta el Apple Developer Program (99 USD al año).

## 1. Descargar el proyecto

En GitHub, botón verde **Code → Download ZIP**, y descomprime.
O desde la terminal: `git clone https://github.com/darocfilms/APP-FILTROS.git`

## 2. Abrir en Xcode

Doble clic en **`ios/App/App.xcodeproj`**.

La primera vez Xcode descarga Capacitor, el puente entre la app web y el iPhone.
Tarda un minuto: espera a que arriba desaparezca *Resolving Package Graph*.

## 3. Firmar con tu Apple ID

1. En la columna izquierda, el proyecto **App** (icono azul) → target **App** →
   pestaña **Signing & Capabilities**.
2. Deja marcado **Automatically manage signing**.
3. En **Team**, elige tu Apple ID (si no aparece: *Add an Account…*).

Si sale *"bundle identifier is not available"*, cambia
`com.darocfilms.laboratorio` por algo tuyo y único, por ejemplo
`com.darocfilms.laboratorio2`.

## 4. Preparar el iPhone (sólo la primera vez)

1. Conéctalo por cable y toca **Confiar** en el iPhone.
2. Activa el **Modo de desarrollador**: Ajustes → Privacidad y seguridad → Modo
   de desarrollador, y reinicia. La opción aparece después de haberlo conectado
   a Xcode una vez.

## 5. Ejecutar

1. Arriba en Xcode, elige **tu iPhone** como destino.
2. Pulsa **▶** (o ⌘R).
3. Con cuenta gratuita, la primera vez el iPhone dirá que el desarrollador no es
   de confianza: Ajustes → General → VPN y gestión de dispositivos → tu Apple ID
   → **Confiar**.

Con cuenta gratuita la app **caduca a los 7 días**: vuelve a darle a ▶ con el
iPhone conectado y se renueva. Con la cuenta de pago dura un año.

## 6. Qué comprobar en el iPhone

Lo que no se puede probar sin un iPhone de verdad:

1. **Cámara** — pide permiso una vez y se ve en directo con la copia 2383.
2. **Foto** — dispara y aparece en la Biblioteca.
3. **Guardar en Fotos** — desde el visor, botón Guardar. Si sale la hoja de
   compartir, elige *Guardar imagen*. Si sale la imagen con *"Mantén pulsada…"*,
   mantenla pulsada y elige *Añadir a Fotos*.
4. **Vídeo** — graba unos segundos y comprueba que tiene sonido.
5. **RAW de Sony** — importa un `.ARW` desde **Archivos** (no desde la
   fototeca, que suele dar un JPEG) y ábrelo en el laboratorio: arriba tiene que
   decir *RAW* y el modelo de la cámara.

Si algo falla, se puede ver la consola de la app: en el Mac, Safari → Ajustes →
Avanzado → *Mostrar funciones para desarrolladores web*; luego menú
**Desarrollar → [tu iPhone] → Laboratorio**. Con lo que diga, se arregla.

## 7. Publicar (opcional)

1. Apúntate al Apple Developer Program.
2. En Xcode, destino **Any iOS Device (arm64)** → **Product → Archive** →
   **Distribute App → App Store Connect → Upload**.
3. En App Store Connect: **TestFlight** para dársela a otras personas, o envíala
   a revisión para la App Store.

Un aviso honesto: Apple rechaza las apps que son sólo una web metida en una caja
(norma 4.2). Esta lleva la app dentro, funciona sin conexión y tiene cámara y
editor propios, que es lo que esa norma pide — pero la decisión es de la
revisión.

## Cuando cambie la app

La app web que va dentro de `ios/` es una copia. Se pone al día con
`npm run ios` (necesita Node 22), y `npm test` falla si alguien cambia la web y
olvida hacerlo. Para ti: vuelve a descargar el proyecto y dale a ▶.

---

### Qué lleva el proyecto, por si hay que tocarlo

| | |
|---|---|
| Identificador | `com.darocfilms.laboratorio` |
| Nombre en el iPhone | Laboratorio |
| iOS mínimo | 15.0 — lo pide WebGL2, que hace todo el revelado |
| Dispositivos | Sólo iPhone, sólo en vertical — la interfaz está hecha para eso |
| Permisos | Cámara, micrófono, añadir a Fotos, abrir fotos de la galería |
| Barra de estado | En blanco siempre: la app es oscura entera |
| Puente | Capacitor 8 por Swift Package Manager, sin CocoaPods |

Dentro de la app, la web se reconoce a sí misma (`isNativeApp()` en
`js/utils/share.js`). Hace falta porque una app nativa es una vista web sin
«Safari» en su user agent, igual que el navegador de WhatsApp, y sin esa
excepción la app se tomaría por uno de ellos y **bloquearía su propia cámara**.
