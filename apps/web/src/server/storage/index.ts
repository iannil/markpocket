// Storage entry point. Importing this module registers the built-in providers
// (side-effect import of ./local) before anyone resolves getStorage().
// Plugins add providers by calling registerStorageProvider at their own load.
import './local';

export { getStorage, registerStorageProvider, type StorageProvider } from './provider';
