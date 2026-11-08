import { render } from 'preact'
import '@fontsource-variable/inter'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './styles.css'
import { App } from './app'

render(<App />, document.getElementById('app')!)
