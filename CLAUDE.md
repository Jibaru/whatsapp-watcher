# WhatsApp Watcher

Notetaker de WhatsApp: KAPSO entrega los mensajes, AWS los procesa con Bedrock y devuelve
recordatorios. El diseño completo está en `docs/ENUNCIADO.md` y el diagrama en `docs/arquitectura.html`.

## Monorepo

Sí, esto es un monorepo con workspaces de Bun. **Un módulo por lambda**, más un núcleo compartido:

```
packages/
  core/     @watcher/core     logger, hash, helpers de entorno
  ingest/   @watcher/ingest   lambda del webhook de KAPSO
infra/      un fichero por lambda (api.ts, ingest.ts), importados desde sst.config.ts
docs/       enunciado y diagrama
```

Las lambdas que faltan (`processor`, `evaluator`, `notifier`) van cada una en su propio
`packages/<nombre>` con su `infra/<nombre>.ts`. Lo compartido sube a `@watcher/core`, nunca se
importa entre módulos de lambda.

## Estructura de cada lambda

Tres fases, en este orden y sin saltarse ninguna:

```
handler     HTTP, formato del proveedor, validación Zod → construye el DTO de entrada
  service   recibe DTO de entrada, opera sobre el dominio, devuelve DTO de salida
    repository   interfaz + implementación; nadie por encima sabe si es Dynamo, S3 o un log
```

- Modelos de dominio: clases con constructor privado y factoría `create()` que valida.
- DTOs de entrada y salida: interfaces, declaradas en el fichero del service.
- El dominio no importa nada de HTTP ni del proveedor.
- El cableado vive en `main.ts` (composition root); el resto recibe sus dependencias por constructor.

## Convenciones

- **Comentarios: los mínimos, y en inglés.** Solo cuando explican un *por qué* que el código no
  puede decir. Nada de comentarios que repitan el nombre de la función.
- Código, identificadores, mensajes de error, eventos de log y nombres de test: en inglés.
- Documentación (`docs/`, este fichero): en español.
- Log estructurado JSON con `event` en snake_case. El teléfono va hasheado, nunca en claro.
- Fail-closed: si falta configuración, se lanza en el arranque en frío, no a mitad de petición.
- Commits: conventional commits, en inglés, sin `Co-Authored-By` ni trailers.

## Comandos

```bash
bun install
bun test packages          # bun run test
bun run typecheck          # tsc --noEmit, cubre packages, infra y sst.config.ts
bun run secret:set         # obligatorio antes del primer deploy
bun run deploy             # sst deploy --stage dev
```

## AWS

| Stage | Perfil | Cuenta | Región |
|---|---|---|---|
| `dev` | `iamadmin-general` | 558232170289 | us-east-1 |
| `production` | `iamadmin-production` | 472008046539 | us-east-1 |

Por ahora solo se trabaja en `dev`. `production` va con `removal: retain` y `protect: true`.
