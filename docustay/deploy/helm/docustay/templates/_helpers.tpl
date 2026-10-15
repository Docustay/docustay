{{- define "docustay.name" -}}docustay{{- end -}}
{{- define "docustay.secretName" -}}{{ if .Values.existingSecret }}{{ .Values.existingSecret }}{{ else }}{{ .Release.Name }}-docustay{{ end }}{{- end -}}
{{- define "docustay.labels" -}}
app.kubernetes.io/name: docustay
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}
{{- define "docustay.dbUrl" -}}
{{- if .Values.postgres.enabled -}}postgresql://docustay:$(KEYSTONE_DB_PASSWORD)@{{ .Release.Name }}-db:5432/docustay{{- else -}}{{ required "postgres.externalUrl is required when postgres.enabled=false" .Values.postgres.externalUrl }}{{- end -}}
{{- end -}}
{{- define "docustay.s3Endpoint" -}}
{{- if .Values.storage.enabled -}}http://{{ .Release.Name }}-storage:8333{{- else -}}{{ required "s3.endpoint is required when storage.enabled=false" .Values.s3.endpoint }}{{- end -}}
{{- end -}}
{{/* the environment every API/worker container shares */}}
{{- define "docustay.appEnv" -}}
- name: KEYSTONE_DB_PASSWORD
  valueFrom: { secretKeyRef: { name: {{ include "docustay.secretName" . }}, key: dbPassword } }
- name: KEYSTONE_DB_SUPERUSER_URL
  value: {{ include "docustay.dbUrl" . | quote }}
- name: KEYSTONE_DB_SSL
  value: {{ .Values.postgres.ssl | quote }}
- name: KEYSTONE_S3_ENDPOINT
  value: {{ include "docustay.s3Endpoint" . | quote }}
- name: KEYSTONE_S3_BUCKET
  value: {{ .Values.s3.bucket | quote }}
- name: KEYSTONE_S3_REGION
  value: {{ .Values.s3.region | quote }}
- name: KEYSTONE_S3_ACCESS_KEY_ID
  valueFrom: { secretKeyRef: { name: {{ include "docustay.secretName" . }}, key: s3AccessKeyId } }
- name: KEYSTONE_S3_SECRET_ACCESS_KEY
  valueFrom: { secretKeyRef: { name: {{ include "docustay.secretName" . }}, key: s3SecretAccessKey } }
- name: KEYSTONE_TOKEN_PEPPER
  valueFrom: { secretKeyRef: { name: {{ include "docustay.secretName" . }}, key: tokenPepper } }
- name: KEYSTONE_LOCAL_AUTH
  value: "1"
- name: KEYSTONE_LOCAL_AUTH_SECRET
  valueFrom: { secretKeyRef: { name: {{ include "docustay.secretName" . }}, key: localAuthSecret } }
- name: KEYSTONE_MASTER_KEY
  valueFrom: { secretKeyRef: { name: {{ include "docustay.secretName" . }}, key: masterKey } }
- name: KEYSTONE_SETUP_TOKEN
  valueFrom: { secretKeyRef: { name: {{ include "docustay.secretName" . }}, key: setupToken } }
- name: RESEND_API_KEY
  valueFrom: { secretKeyRef: { name: {{ include "docustay.secretName" . }}, key: resendApiKey, optional: true } }
- name: KEYSTONE_GOTENBERG_URL
  value: "http://{{ .Release.Name }}-gotenberg:3000"
- name: KEYSTONE_PUBLIC_URL
  value: {{ .Values.publicUrl | quote }}
- name: KEYSTONE_DOCUSTAY_APP_URL
  value: {{ .Values.publicUrl | quote }}
- name: KEYSTONE_DOCUSTAY_SIGN_URL
  value: {{ .Values.publicUrl | quote }}
- name: KEYSTONE_SELF_HOST
  value: "1"
- name: KEYSTONE_TRUSTED_PROXY_HOPS
  value: {{ .Values.ingress.trustedProxyHops | quote }}
- name: DOCUSTAY_TELEMETRY
  value: {{ .Values.telemetry | quote }}
{{- if .Values.licenseKey }}
- name: DOCUSTAY_LICENSE_KEY
  value: {{ .Values.licenseKey | quote }}
{{- end }}
{{- if .Values.metrics.token }}
- name: KEYSTONE_METRICS_TOKEN
  value: {{ .Values.metrics.token | quote }}
{{- end }}
{{- with .Values.extraEnv }}
{{ toYaml . }}
{{- end }}
{{- end -}}
