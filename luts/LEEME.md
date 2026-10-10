# LUT Kodak del Laboratorio

Las emulsiones Kodak de la app —cine y negativo— para usarlas fuera de ella:
en Lightroom como **perfiles**, y en cualquier otro programa como **.cube**.

| Kodak cine | Kodak negativo |
|---|---|
| Vision3 250D | Portra 400 |
| Vision3 500T | Portra 800 |
| 2383 (copia de cine) | Gold 200 |
| | Ektar 100 |
| | Tri-X 400 (blanco y negro) |

Son las mismas que en el laboratorio de la app, no una imitación: cada color
sale de su motor. Con una diferencia: un LUT sólo cambia colores, así que
**no llevan grano ni viñeta** (dependen de dónde está cada píxel, no de su
color). Si los quieres, añádelos con *Efectos* en Lightroom.

```
lightroom/   perfiles .xmp — Lightroom Classic, Lightroom, Camera Raw
cube/        .cube de 33 puntos — Photoshop, Premiere, DaVinci, Final Cut, CapCut…
```

---

## Lightroom Classic

1. Módulo **Revelar** → panel **Básicos** → al lado de *Perfil*, el icono de
   cuatro rectángulos (**Explorar perfiles**).
2. Arriba a la izquierda, **+** → **Importar perfiles…**
3. Elige los `.xmp` de la carpeta `lightroom` (puedes seleccionar los ocho de
   una vez, o un `.zip` con ellos).

Aparecen en dos grupos: **Laboratorio · Kodak cine** y **Laboratorio · Kodak
negativo**. Cada uno tiene su deslizador de **Cantidad**, de 0 a 200.

## Lightroom (el de la nube) y Lightroom móvil

En el ordenador: **Editar** → **Perfil** → **Explorar** → menú **…** →
**Importar perfiles**. Se sincronizan solos con el iPhone.

## Camera Raw / Photoshop

En Camera Raw, el mismo navegador de perfiles → **…** → **Importar perfiles y
ajustes preestablecidos**.

Si alguna versión no aceptara los `.xmp`, el perfil se puede crear desde el
`.cube` en Camera Raw: pestaña **Ajustes preestablecidos**, mantén pulsada
**Opción (⌥)** y haz clic en el botón de crear (pasa a decir **Crear perfil**),
marca **Tabla de consulta de color**, elige el `.cube` y acepta.

## Los .cube

| Programa | Dónde |
|---|---|
| Photoshop | Capa → Nueva capa de ajuste → **Consulta de colores** → Archivo 3DLUT |
| Premiere | Lumetri → **Creativa** → Aspecto → Explorar |
| DaVinci Resolve | En un nodo: clic derecho → **LUT** (copia la carpeta en la de LUT de Resolve) |
| Final Cut Pro | Efecto **LUT personalizado** → Elegir LUT personalizado |

---

## Lo que conviene saber

- **Esperan una imagen normal**, en sRGB o Rec.709: una foto, o vídeo ya
  convertido a Rec.709. Sobre vídeo en **LOG** (S-Log3 de la FX30, por
  ejemplo) primero va la conversión a Rec.709 —el LUT de Sony o una
  transformación de espacio de color— y después este.
- **En un RAW de Lightroom** el perfil se aplica sobre el revelado de Adobe:
  ajusta antes la exposición y el balance como siempre, y el perfil pone la
  película encima.
- **Vision3 500T** está equilibrada a tungsteno, como la de verdad: con luz de
  día vira a azul. Es el aspecto de la 500T de noche en la calle. Para que no
  vire, sube la temperatura en Lightroom.
- **Vision3 250D y 500T** son planas a propósito: son negativo de cámara, que
  en cine se etalona después. La que pone el contraste de sala es la **2383**.
- La **Kodachrome 64** no está: es diapositiva, ni negativo ni cine.

## Cómo se hicieron

Con `tools/luts.mjs`, que revela cada punto de la retícula con el motor de
la app en coma flotante y comprueba antes de escribir nada que el LUT aplicado
a una carta de color da lo mismo que la app: de media, 0,3 niveles de 255 —el
propio tramado de la app—; el 99 % de los colores, a menos de 3. Las mayores
diferencias, de 4 a 9 niveles, están en verdes y azules casi neón, donde la
emulsión saca el color de la gama; en una foto real no aparecen.

Los perfiles de Lightroom llevan la tabla en el formato del DNG SDK de Adobe,
de 32 puntos (el máximo de Camera Raw), y se han leído de vuelta con un
decodificador independiente para comprobarlos.
