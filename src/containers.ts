
import * as core from 'synapse:core'
import * as lib from 'synapse:lib'
import * as path from 'node:path'
import * as child_process from 'node:child_process'

// Realistically you'd probably not have a resource _just_ for a dockerfile
// But I already had this code lying around so I slapped it in
class GeneratedDockerfile extends core.defineResource({
    create: async (bundle: lib.Bundle) => {
        const artifactFs = core.getArtifactFs()
        const resolvedDest = await artifactFs.resolveArtifact(bundle.destination)

        const localPath = path.basename(resolvedDest)
        const baseImage = 'node:24'
        const workdir = '/app'
        const entrypoint = `"node", "./${localPath}"`

        const inlinedDockerfile = `
FROM ${baseImage}
WORKDIR ${workdir}
COPY [ "${localPath}", "./" ]
CMD [ ${entrypoint} ]
`.trim()
    
        const pointer = await artifactFs.writeArtifact(Buffer.from(inlinedDockerfile, 'utf-8'), {
            dependencies: [bundle.destination]
        })
    
        return { location: pointer }
    },
}) {}

const shouldLog = !!Number(process.env.LOG_DOCKER)

async function runDocker(args: string[], stdin?: string, cwd?: string): Promise<{ stdout: string, stderr: string }> {
    return new Promise((resolve, reject) => {
        try {
            if (shouldLog) {
                console.log(`Running docker with args (cwd: ${cwd ?? process.cwd()})`, args)
            }
            const proc = child_process.execFile('docker', args, { cwd }, (err, stdout, stderr) => {
                if (err) return reject(err)
                resolve({ stdout, stderr })
            })

            proc.on('spawn', () => {
                if (stdin) {
                    proc.stdin?.end(stdin)
                }
            })

            proc.on('error', reject)
        } catch (e) {
            reject(e)
        }
    })
}

interface ContainerBuildProps {
    readonly dockerfilePath: string
}

async function buildContainer(props: ContainerBuildProps) {
    const resolved = await core.getArtifactFs().resolveArtifact(props.dockerfilePath)
    const { stdout } = await runDocker(['build', '-q', '-f', resolved, '.'], undefined, path.dirname(resolved))
    const buildId = stdout.trim()

    return { buildId }
}

async function removeContainer(buildId: string) {
    try {
        const result = await runDocker(['image', 'rm', `${buildId}`])
    } catch (e) {
        if (!(e as any)?.message.includes('No such image')) {
            throw e
        }
    }
}

export interface ServiceOpts {
    ports: Record<string | number, string | number>
    env?: Record<string, string | number | undefined>
    volumes?: Record<string, string>
}

class ContainerDaemon extends core.defineResource({
    create: async (props: ContainerBuildProps & ServiceOpts & { hostname: string }) => {
        const { buildId } = await buildContainer(props)

        try {
            const ports = Object.entries(props.ports).map(x => ['-p', `${x[0]}:${x[1]}`]).flat()
            const env = Object.entries(props.env ?? {}).filter(x => x[1] !== undefined).map(x => [`-e`, `${x[0]}=${x[1]}`]).flat()
            const volumes = Object.entries(props.volumes ?? {}).map(x => ['-v', `${x[0]}:${x[1]}`]).flat()
            const { stdout } = await runDocker(['run', '-d', ...ports, ...env, ...volumes, buildId])

            return { buildId, instanceId: stdout.trim(), hostname: props.hostname }
        } catch (err) {
            await removeContainer(buildId)
            throw err
        }
    },
    delete: async state => {
        try {
            const result = await runDocker(['rm', '-f', `${state.instanceId}`])
        } catch (e) {
            if (!(e as any)?.message.includes('is not running') && !(e as any)?.message.includes('No such container')) {
                throw e
            }
        }
    }
}) {}

export function localContainerService(bundle: lib.Bundle, opts: ServiceOpts) {
    const dockerfile = new GeneratedDockerfile(bundle)
    
    return new ContainerDaemon({ ...opts, dockerfilePath: dockerfile.location, hostname: 'localhost' })
}
