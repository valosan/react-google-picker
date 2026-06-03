import React from 'react'
import PropTypes from 'prop-types'
import loadScript from 'load-script'

// `api.js` still provides the Picker library (`gapi.load('picker')`).
const GOOGLE_SDK_URL = 'https://apis.google.com/js/api.js'
// Google Identity Services provides OAuth tokens (replaces the deprecated `gapi.auth`).
const GOOGLE_GSI_URL = 'https://accounts.google.com/gsi/client'

const pickerNamespace = () => window.google.picker

let gapiPromise = null
let gsiPromise = null

// Load an external script once, sharing the same promise across every component instance.
const loadScriptOnce = (url, isReady) => {
  return new Promise((resolve, reject) => {
    if (isReady()) {
      resolve()
      return
    }

    loadScript(url, err => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
  })
}

const isGapiReady = () => !!window.gapi
const isGsiReady = () => !!(window.google && window.google.accounts && window.google.accounts.oauth2)

const loadGapi = () => {
  if (!gapiPromise) {
    gapiPromise = loadScriptOnce(GOOGLE_SDK_URL, isGapiReady)
  }
  return gapiPromise
}

const loadGsi = () => {
  if (!gsiPromise) {
    gsiPromise = loadScriptOnce(GOOGLE_GSI_URL, isGsiReady)
  }
  return gsiPromise
}

export const viewMap = {
  DOCS: 'DocsView',
  DOCS_IMAGES: 'DocsView',
  DOCUMENTS: 'DocsView',
  PRESENTATIONS: 'DocsView',
  SPREADSHEETS: 'DocsView',
  FORMS: 'DocsView',
  DOCS_IMAGES_AND_VIDEOS: 'DocsView',
  DOCS_VIDEOS: 'DocsView',
  FOLDERS: 'DocsView',
  PDFS: 'DocsView',
  IMAGE_SEARCH: 'ImageSearchView',
  MAPS: 'MapsView',
  PHOTOS: 'PhotosView',
  PHOTO_ALBUMS: 'PhotoAlbumsView',
  VIDEO_SEARCH: 'VideoSearchView',
  WEBCAM: 'WebCamView',
  // no view ID for `DocsUploadView`
  DocsUploadView: 'DocsUploadView'
}

export default class GoogleChooser extends React.Component {
  static propTypes = {
    children: PropTypes.node,
    clientId: PropTypes.string.isRequired,
    developerKey: PropTypes.string,
    scope: PropTypes.array,
    viewId: PropTypes.string,
    query: PropTypes.string,
    authImmediate: PropTypes.bool,
    origin: PropTypes.string,
    onChange: PropTypes.func,
    onAuthenticate: PropTypes.func,
    onAuthFailed: PropTypes.func,
    createPicker: PropTypes.func,
    customizePicker: PropTypes.func,
    multiselect: PropTypes.bool,
    navHidden: PropTypes.bool,
    disabled: PropTypes.bool
  }

  static defaultProps = {
    onChange: () => {},
    onAuthenticate: () => {},
    onAuthFailed: () => {},
    scope: ['https://www.googleapis.com/auth/drive.readonly'],
    viewId: 'DOCS',
    query: '',
    authImmediate: false,
    multiselect: false,
    navHidden: false,
    disabled: false
  }

  constructor (props) {
    super(props)

    this.pickerApiLoaded = false
    this.tokenClient = null
    this.accessToken = null
    this.tokenExpiresAt = 0

    this.onChoose = this.onChoose.bind(this)
    this.buildView = this.buildView.bind(this)
    this.handleTokenResponse = this.handleTokenResponse.bind(this)
  }

  componentDidMount () {
    // Load the Picker library.
    loadGapi()
      .then(() => new Promise(resolve => window.gapi.load('picker', resolve)))
      .then(() => { this.pickerApiLoaded = true })

    // Load Google Identity Services and create the OAuth token client.
    loadGsi()
      .then(() => this.initTokenClient())
  }

  componentWillUnmount () {
    this.disposePicker()
  }

  isPickerReady () {
    return this.pickerApiLoaded && isGapiReady()
  }

  initTokenClient () {
    this.tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: this.props.clientId,
      scope: this.props.scope.join(' '),
      callback: this.handleTokenResponse,
      error_callback: error => this.props.onAuthFailed(error)
    })
  }

  handleTokenResponse (response) {
    if (response && response.access_token) {
      this.accessToken = response.access_token
      // `expires_in` is in seconds; keep a small safety margin.
      this.tokenExpiresAt = Date.now() + ((response.expires_in - 60) * 1000)
      this.createPicker(this.accessToken)
    } else {
      this.props.onAuthFailed(response)
    }
  }

  hasValidToken () {
    return !!this.accessToken && Date.now() < this.tokenExpiresAt
  }

  onChoose () {
    if (!this.isPickerReady() || !this.tokenClient || this.props.disabled) {
      return null
    }

    if (this.hasValidToken()) {
      this.createPicker(this.accessToken)
    } else {
      // `prompt: ''` reuses a prior grant when possible and only prompts when needed.
      // GIS has no true "immediate" mode, so `authImmediate` no longer forces a silent
      // request; an empty prompt is the closest equivalent it supports.
      this.tokenClient.requestAccessToken({ prompt: '' })
    }
  }

  buildView (viewId) {
    const namespace = pickerNamespace()
    const className = viewMap[viewId] || 'View'

    return [ 'View', 'DocsView' ].indexOf(className) !== -1
      ? new namespace[className](namespace.ViewId[viewId])
      : new namespace[className]()
  }

  createPicker (oauthToken) {
    this.disposePicker()

    const { onAuthenticate, createPicker } = this.props

    onAuthenticate(oauthToken)

    if (createPicker) {
      return createPicker(window.google, oauthToken)
    }

    const { viewId, mimeTypes, query } = this.props
    const namespace = pickerNamespace()
    const view = this.buildView(viewId)

    if (!view) {
      throw new Error("Can't find view by viewId")
    }

    if (mimeTypes) {
      view.setMimeTypes(mimeTypes.join(','))
    }

    if (query) {
      view.setQuery(query)
    }

    const { developerKey, onChange, origin, navHidden, multiselect, customizePicker } = this.props

    const picker = new namespace.PickerBuilder()
      .addView(view)
      .setOAuthToken(oauthToken)
      .setDeveloperKey(developerKey)
      .setCallback(onChange)

    if (origin) {
      picker.setOrigin(origin)
    }

    if (navHidden) {
      picker.enableFeature(namespace.Feature.NAV_HIDDEN)
    }

    if (multiselect) {
      picker.enableFeature(namespace.Feature.MULTISELECT_ENABLED)
    }

    if (customizePicker) {
      customizePicker(picker, { namespace, view, buildView: this.buildView })
    }

    this.picker = picker.build().setVisible(true)
  }

  disposePicker () {
    if (this.picker) {
      this.picker.setVisible(true).dispose()
    }
  }

  render () {
    return (
      <div onClick={this.onChoose}>
        {this.props.children || <button>Open google chooser</button>}
      </div>
    )
  }
}
