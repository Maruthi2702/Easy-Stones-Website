import { registerRootComponent } from 'expo';
// The location task must be defined before the app starts (background updates can launch it without the UI).
import './src/host/handlers/location';
import App from './App';

registerRootComponent(App);
