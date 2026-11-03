export interface JiraConf {
  /** Site address, e.g. https://yourteam.atlassian.net or https://jira.company.vn */
  url: string
  /** Jira Cloud: account e-mail (+ API token). Empty = Jira Server / Data Center personal access token. */
  email: string
  project: string
  issueType: string
  /** Map the bug's severity to Jira priority (Highest / High / Medium / Low). */
  usePriority: boolean
}

export interface JiraState {
  conf: JiraConf | null
  hasToken: boolean
}

export interface JiraCheck {
  user: string
  projectName: string
  issueTypes: string[]
}

export interface JiraIssue {
  key: string
  url: string
  /** Attachments that could not be uploaded (issue was still created). */
  warning?: string
}
