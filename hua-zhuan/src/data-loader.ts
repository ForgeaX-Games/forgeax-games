export interface GameConfig {
  [key: string]: unknown;
}

export interface PlayerSave {
  [key: string]: unknown;
}

const CONFIG_PATH = './data/config.json';
const SAVE_PATH = './save/player.json';

let _config: GameConfig | null = null;
let _save: PlayerSave | null = null;

export function getConfig<T extends GameConfig = GameConfig>(): T {
  if (!_config) {
    _config = JSON.parse(localStorage.getItem('gameConfig') || '{}') as GameConfig;
  }
  return _config as T;
}

export function getSave<T extends PlayerSave = PlayerSave>(): T {
  if (!_save) {
    const raw = localStorage.getItem('playerSave');
    _save = raw ? JSON.parse(raw) : {};
  }
  return _save as T;
}

export function writeSave(save: PlayerSave): void {
  _save = save;
  localStorage.setItem('playerSave', JSON.stringify(save));
}

export async function loadConfigFromFile(): Promise<GameConfig> {
  try {
    const resp = await fetch(CONFIG_PATH);
    if (resp.ok) {
      _config = (await resp.json()) as GameConfig;
      localStorage.setItem('gameConfig', JSON.stringify(_config));
    }
  } catch {
    // fallback to localStorage cache or empty
    if (!_config) _config = JSON.parse(localStorage.getItem('gameConfig') || '{}');
  }
  return _config!;
}
