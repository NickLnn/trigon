const COMMONS = 'https://commons.wikimedia.org/wiki/Special:FilePath/';
const OFFICE_CDN = 'https://res-1.cdn.office.net/files/fabric-cdn-prod_20230815.002/assets/brand-icons/product/svg/';

/**
 * Curated vendors offered in the icon picker. Icons are fetched from each vendor's own site on demand;
 * `iconUrl` pins an official logo for products whose site doesn't expose one (sign-in portals etc.).
 */
export const ICON_CATALOG: { name: string; domain: string; category: string; iconUrl?: string }[] = [
  // Microsoft
  { name: 'Microsoft', domain: 'microsoft.com', category: 'Microsoft' },
  { name: 'Azure', domain: 'azure.microsoft.com', category: 'Microsoft' },
  { name: 'Microsoft 365', domain: 'microsoft365.com', category: 'Microsoft' },
  { name: 'Entra ID', domain: 'entra.microsoft.com', category: 'Microsoft', iconUrl: COMMONS + 'Microsoft_Entra_ID_color_icon.svg' },
  { name: 'Intune', domain: 'intune.microsoft.com', category: 'Microsoft', iconUrl: COMMONS + 'Microsoft-intune.svg' },
  { name: 'Teams', domain: 'teams.microsoft.com', category: 'Microsoft' },
  { name: 'SharePoint', domain: 'sharepoint.com', category: 'Microsoft', iconUrl: OFFICE_CDN + 'sharepoint_48x1.svg' },
  { name: 'OneDrive', domain: 'onedrive.live.com', category: 'Microsoft', iconUrl: OFFICE_CDN + 'onedrive_48x1.svg' },
  { name: 'Outlook', domain: 'outlook.com', category: 'Microsoft' },
  { name: 'Windows', domain: 'windows.com', category: 'Microsoft', iconUrl: COMMONS + 'Windows_logo_-_2021.svg' },
  { name: 'Power BI', domain: 'powerbi.com', category: 'Microsoft' },
  // Virtualisation & OS
  { name: 'VMware', domain: 'vmware.com', category: 'Infrastructure' },
  { name: 'Broadcom', domain: 'broadcom.com', category: 'Infrastructure' },
  { name: 'Proxmox', domain: 'proxmox.com', category: 'Infrastructure' },
  { name: 'Nutanix', domain: 'nutanix.com', category: 'Infrastructure' },
  { name: 'Citrix', domain: 'citrix.com', category: 'Infrastructure' },
  { name: 'Red Hat', domain: 'redhat.com', category: 'Infrastructure' },
  { name: 'Ubuntu', domain: 'ubuntu.com', category: 'Infrastructure' },
  { name: 'Debian', domain: 'debian.org', category: 'Infrastructure' },
  { name: 'SUSE', domain: 'suse.com', category: 'Infrastructure' },
  { name: 'Linux Foundation', domain: 'linuxfoundation.org', category: 'Infrastructure' },
  { name: 'Apple', domain: 'apple.com', category: 'Infrastructure' },
  { name: 'Synology', domain: 'synology.com', category: 'Infrastructure' },
  { name: 'Veeam', domain: 'veeam.com', category: 'Infrastructure' },
  // Cloud & DevOps
  { name: 'AWS', domain: 'aws.amazon.com', category: 'Cloud & DevOps' },
  { name: 'Google Cloud', domain: 'cloud.google.com', category: 'Cloud & DevOps' },
  { name: 'Cloudflare', domain: 'cloudflare.com', category: 'Cloud & DevOps' },
  { name: 'Docker', domain: 'docker.com', category: 'Cloud & DevOps' },
  { name: 'Kubernetes', domain: 'kubernetes.io', category: 'Cloud & DevOps' },
  { name: 'HashiCorp', domain: 'hashicorp.com', category: 'Cloud & DevOps' },
  { name: 'Ansible', domain: 'ansible.com', category: 'Cloud & DevOps' },
  { name: 'GitHub', domain: 'github.com', category: 'Cloud & DevOps' },
  { name: 'GitLab', domain: 'gitlab.com', category: 'Cloud & DevOps' },
  { name: 'Jenkins', domain: 'jenkins.io', category: 'Cloud & DevOps' },
  { name: 'Atlassian', domain: 'atlassian.com', category: 'Cloud & DevOps' },
  { name: 'Grafana', domain: 'grafana.com', category: 'Cloud & DevOps' },
  { name: 'Elastic', domain: 'elastic.co', category: 'Cloud & DevOps' },
  { name: 'PostgreSQL', domain: 'postgresql.org', category: 'Cloud & DevOps' },
  { name: 'Oracle', domain: 'oracle.com', category: 'Cloud & DevOps' },
  // Network & security
  { name: 'Cisco', domain: 'cisco.com', category: 'Network & Security' },
  { name: 'Fortinet', domain: 'fortinet.com', category: 'Network & Security' },
  { name: 'Palo Alto Networks', domain: 'paloaltonetworks.com', category: 'Network & Security' },
  { name: 'Juniper', domain: 'juniper.net', category: 'Network & Security' },
  { name: 'Ubiquiti', domain: 'ui.com', category: 'Network & Security' },
  { name: 'Sophos', domain: 'sophos.com', category: 'Network & Security' },
  { name: 'CrowdStrike', domain: 'crowdstrike.com', category: 'Network & Security' },
  { name: 'SentinelOne', domain: 'sentinelone.com', category: 'Network & Security' },
  { name: 'Okta', domain: 'okta.com', category: 'Network & Security' },
  { name: 'Splunk', domain: 'splunk.com', category: 'Network & Security' },
  // Hardware
  { name: 'Dell', domain: 'dell.com', category: 'Hardware' },
  { name: 'HPE', domain: 'hpe.com', category: 'Hardware' },
  { name: 'HP', domain: 'hp.com', category: 'Hardware' },
  { name: 'Lenovo', domain: 'lenovo.com', category: 'Hardware' },
  { name: 'NetApp', domain: 'netapp.com', category: 'Hardware' },
  { name: 'Pure Storage', domain: 'purestorage.com', category: 'Hardware' },
];
