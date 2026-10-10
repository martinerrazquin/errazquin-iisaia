import Reveal from 'reveal.js'
import Notes from 'reveal.js/plugin/notes'
import 'reveal.js/reveal.css'
import '@fontsource-variable/geist'
import './style.css'

Reveal.initialize({
  hash: true,
  slideNumber: 'c/t',
  width: 1280,
  height: 720,
  margin: 0.04,
  center: false,
  transition: 'fade',
  backgroundTransition: 'none',
  plugins: [Notes],
})
