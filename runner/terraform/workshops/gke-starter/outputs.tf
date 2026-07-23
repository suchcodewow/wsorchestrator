output "project_id" {
  value = module.project.project_id
}

output "cluster_name" {
  value = module.gke.cluster_name
}

output "artifact_registry" {
  value = module.gke.artifact_registry
}
