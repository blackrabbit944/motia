import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { parse } from 'yaml'

export interface StateConfig {
  adapter: 'memory' | 'file' | 'redis'
  host?: string
  port?: number
  password?: string
  ttl?: number
  filePath?: string
}

export interface MotiaConfig {
  state: StateConfig
}

const DEFAULT_CONFIG: MotiaConfig = {
  state: {
    adapter: 'file',
    filePath: '.motia',
  },
}

export function readConfig(baseDir: string = process.cwd()): MotiaConfig {
  const configPath = join(baseDir, 'config.yml')

  if (!existsSync(configPath)) {
    console.log('⚠️ config.yml not found, using default configuration')
    return DEFAULT_CONFIG
  }

  try {
    const configContent = readFileSync(configPath, 'utf8')
    const parsedConfig = parse(configContent) as Partial<MotiaConfig>

    // 合并默认配置
    const config: MotiaConfig = {
      state: {
        ...DEFAULT_CONFIG.state,
        ...parsedConfig.state,
      },
    }

    console.log('✅ Configuration loaded from config.yml:', config)
    return config
  } catch (error) {
    console.error('❌ Error reading config.yml:', error)
    return DEFAULT_CONFIG
  }
}
