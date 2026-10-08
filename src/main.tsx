import { render } from 'preact'
import { AppController } from './app/AppController'
import { App } from './ui/App'
import { updateColorScheme } from './ui/colorScheme'
import './styles.css'

const controller = new AppController({ onThemesChange: updateColorScheme })
updateColorScheme()

render(<App controller={controller} />, document.getElementById('app')!)
