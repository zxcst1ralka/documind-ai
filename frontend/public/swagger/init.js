
const ui = globalThis.SwaggerUIBundle
ui({
  url: '/api/v1/openapi.json',
  dom_id: '#swagger-ui',
  persistAuthorization: false,
  validatorUrl: null,
  requestInterceptor(request) {
    if (new globalThis.URL(request.url, globalThis.location.href).origin === globalThis.location.origin) {
      request.headers['X-DocuMind-Client'] = 'web'
    }
    return request
  },
})
