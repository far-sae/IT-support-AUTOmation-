{{/* Common helpers */}}
{{- define "relay.namespace" -}}
{{- default .Release.Namespace .Values.namespace.name -}}
{{- end -}}

{{- define "relay.labels" -}}
app.kubernetes.io/name:       relay
app.kubernetes.io/instance:   {{ .Release.Name }}
app.kubernetes.io/version:    {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart:                {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end -}}
