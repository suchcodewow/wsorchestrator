# VSCODE: ctrl/cmd+k+1 folds all functions, ctrl/cmd+k+j unfold all functions. Check '.vscode/launch.json' for any current parameters
# VSCODE: use setting ["powershell.codeFolding.showLastLine": false] to hide the trailing '}' of each function

param (
    [Parameter(Position = 0)][string]$action,           # action to execute
    [Parameter()][switch] $aws,                         # [CREATE] create aws classroom for event TODO
    [Parameter()][switch] $azure,                       # [CREATE] create azure classroom for event TODO
    [Parameter()][switch] $cloudCommands,               # debug option: enable to show commands
    [Parameter()][switch] $detailedMode,                # debug option: level 0 (debug/info/errors) output (versus standard level 1 info/errors)
    [Parameter()][string] $eventName,                   # [CREATE] specify event name
    [Parameter()][switch] $gcp,                         # [CREATE] create gcp classroom for event
    [Parameter()][string] $googleCloudProjectOverride,  # debug option: override project creation to use a specific project
    [Parameter()][string] $harnessPAT,                  # [CREATE] harness PAT (default is community HarnessEvents account)
    [Parameter()][int] $hourLimit,                      # [REMOVE] max event lifespan in hours (WARNING: THIS AFFECTS ALL EVENTS)
    [Parameter()][string] $instructorName,              # [CREATE] specify instructorName (defaults to current user)
    [Parameter()][string] $newAccount,                  # [CREATE] specify new account name (will create account, licenses, PAT)
    [Parameter()][switch] $skipInfra,                   # Suppress creation of project resources for NikP IaCM version
    [Parameter()][int] $timeOffset,                     # debug option: set hour offset when creating event to test event cleanup
    [Parameter()][int] $userCount,                      # [CREATE MODE] specify number of attendees (default is 1)
    [Parameter()][switch] $whatif                       # debug option:testing option to prevent significant changes
)

## Core Functions
function Get-Help {
    Write-Host
    Write-Host "Action required.  Options are 'create' or 'remove'."
    Write-host "example: ./harnessevents.ps1 create"
    Write-Host
}
function Get-Prefs($scriptPath) {
    # Set default verbosity
    $PSDefaultParameterValues['Invoke-*:Verbose'] = $false
    # Do the things for the command line switches selected
    if ($detailedMode) { $script:outputLevel = 0 } else { $script:outputLevel = 1 }
    if ($cloudCommands) { $script:showCommands = $true } else { $script:showCommands = $false }
    $script:retainLog = $false
    if ($googleCloudProjectOverride) { $script:googleCloudProjectOverride }
    $script:ProgressPreference = "SilentlyContinue"
    if ($scriptPath) {
        $script:logFile = "$($scriptPath).log"
        Send-Update -t 0 -c "Log: $logFile"
        if ((test-path $logFile) -and -not $retainLog) {
            Remove-Item $logFile
        }
        $script:configFile = "$($scriptPath).conf"
        Send-Update -t 0 -c "Config: $configFile"
    }
    if ($outputLevel -eq 0) {
        $script:choiceColumns = @("Option", "description", "current", "key", "callFunction", "callProperties")
        $script:providerColumns = @("option", "provider", "name", "identifier", "userid", "default")
        $script:eventColumns = @("option","Name","Email", "ID", "default")
    }
    else {
        $script:choiceColumns = @("Option", "description", "current")
        $script:providerColumns = @("option", "provider", "name")
        $script:eventColumns = @("option","Name", "Email")
    }
    if ($action -eq "reload") {
        Send-Update -t 1 -c "Reloading functions for testing. Skipping conf cleanup."
    }
    else {
        if (Test-Path $configFile) {
            Send-Update -c "Reading config" -t 0
            $script:previousConfig = Get-Content $configFile -Raw | ConvertFrom-Json
        }
        $script:config = [PSCustomObject]@{}
        $config | ConvertTo-Json | Out-File $configFile
        $carryoverVariables = @(
            "GoogleAccessToken",
            "GoogleAccessTokenTimestamp",
            "GoogleAppToken",
            "GoogleAppTokenTimestamp",
            "AdminProjectId",
            "HarnessFFToken",
            "HarnessEventsPAT",
            "GoogleAccessToken",
            "GoogleServiceAccount",
            "ServiceAccountEmail",
            "ServiceAccountKey")
        foreach ($c in $carryoverVariables) {
            if ($previousConfig.$c) { Set-Prefs -k $c -v $previousConfig.$c } else { $script:refreshToken = $true }
        }
    }
    # if we're missing any variables trigger a full refresh
    if ($refreshToken) { Set-Prefs -k "GoogleAccessToken" }
    Send-Update -c "CREATED config" -t 0

}
function Get-Randomstring {
    [CmdletBinding()]
    param (
        [Parameter()]
        [int]
        $characterCount
    )
    if (-not $characterCount) { $characterCount = 6 }
    return -join ((65..90) + (97..122) + (48..57) | Get-Random -Count $characterCount | ForEach-Object { [char]$_ })
}
function Get-UserName {
    # Generate a fun PG-rated madlibs-style username
    $Prefix = @(
        "abundant",
        "delightful",
        "high",
        "nutritious",
        "square",
        "adorable",
        "dirty",
        "hollow",
        "obedient",
        "steep",
        "agreeable",
        "drab",
        "hot",
        "living",
        "dry",
        "hot",
        "odd",
        "straight",
        "dusty",
        "huge",
        "strong",
        "beautiful",
        "eager",
        "icy",
        "orange",
        "substantial",
        "better",
        "early",
        "immense",
        "panicky",
        "sweet",
        "bewildered",
        "easy",
        "important",
        "petite",
        "swift",
        "big",
        "elegant",
        "inexpensive",
        "plain",
        "tall",
        "embarrassed",
        "itchy",
        "powerful",
        "tart",
        "black",
        "prickly",
        "tasteless",
        "faint",
        "jolly",
        "proud",
        "teeny",
        "brave",
        "famous",
        "kind",
        "purple",
        "tender",
        "breeze",
        "fancy",
        "broad",
        "fast",
        "quaint",
        "thoughtful",
        "tiny",
        "bumpy",
        "light",
        "quiet",
        "calm",
        "fierce",
        "little",
        "rainy",
        "careful",
        "lively",
        "rapid",
        "uneven",
        "chilly",
        "flaky",
        "interested",
        "flat",
        "relieved",
        "unsightly",
        "clean",
        "fluffy",
        "loud",
        "uptight",
        "clever",
        "freezing",
        "vast",
        "clumsy",
        "fresh",
        "lumpy",
        "victorious",
        "cold",
        "magnificent",
        "warm",
        "colossal",
        "gentle",
        "mammoth",
        "salty",
        "gifted",
        "scary",
        "gigantic",
        "massive",
        "scrawny",
        "glamorous",
        "screeching",
        "whispering",
        "cuddly",
        "messy",
        "shallow",
        "curly",
        "miniature",
        "curved",
        "great",
        "modern",
        "shy",
        "wide-eyed",
        "witty",
        "damp",
        "grumpy",
        "mysterious",
        "skinny",
        "wooden",
        "handsome",
        "narrow",
        "worried",
        "deafening",
        "happy",
        "nerdy",
        "heavy",
        "soft",
        "helpful",
        "noisy",
        "sparkling",
        "young",
        "delicious"
    )
      
    $Name = @(
        "apple",
        "seashore",
        "badge",
        "flock",
        "sidewalk",
        "basket",
        "basketball",
        "furniture",
        "smoke",
        "battle",
        "geese",
        "bathtub",
        "beast",
        "ghost",
        "nose",
        "beetle",
        "giraffe",
        "sidewalk",
        "beggar",
        "governor",
        "honey",
        "stage",
        "bubble",
        "hope",
        "station",
        "bucket",
        "income",
        "cactus",
        "island",
        "throne",
        "cannon",
        "cow",
        "judge",
        "toothbrush",
        "celery",
        "lamp",
        "turkey",
        "cellar",
        "lettuce",
        "umbrella",
        "marble",
        "underwear",
        "coach",
        "month",
        "vacation",
        "coast",
        "vegetable",
        "crate",
        "ocean",
        "plane",
        "donkey",
        "playground",
        "visitor",
        "voyage"
    )      
    return "$(Get-Random -inputObject $Prefix)$(Get-Random -inputObject $Name)"
}
function Set-Prefs {
    # Set a new keypair value. retrieve with $config.<yourkey>
    # Values are stored in <script>.conf
    param(
        $k, # key
        $v, # value
        [switch]$output # Output the value to debug stream
    )
    if ($v) {
        if ($o) { Send-Update -c "Updating key: $k -> $v" -t 1 }
        $config | Add-Member -MemberType NoteProperty -Name $k -Value $v -Force
    }
    else {
        if ($k -and $config.$k) {
            if ($o) { Send-Update -c "Deleting config key: $k" -t 0 }
            $config.PSObject.Properties.Remove($k)
        }
        else {
            if ($o) { Send-Update -c "Key didn't exist: $k" -t 0 }
        }
    }     
    if ($MyInvocation.MyCommand.Name) {
        $config | ConvertTo-Json | Out-File $configFile
    }
    else {
        Send-Update -c "No command name, config will not be saved" -t 0
    }
}
function Send-Update {
    # Handle output to screen & log, execute commands to cloud systems and return results
    param(
        [string] $content, # Message content to log/write to screen
        [int] $type, # [0/1/2] log levels respectively: debug/info/errors, info/errors, errors
        [string] $run, # Run a command and return result
        [switch] $append, # [$true/false] skip the newline (next entry will be on same line)
        [switch] $errorSuppression, # use this switch to suppress error output (useful for extraneous warnings)
        [switch] $outputSuppression, # use to suppress normal output
        [switch] $whatIf # do NOT run command, just SHOW for troubleshooting
    )
    $Params = @{}
    if ($whatIf) { $whatIfComment = "!WHATIF! " }
    if ($run) { $Params['ForegroundColor'] = "Magenta"; $start = "[$whatIfComment>]" }
    else {
        Switch ($type) {
            0 { $Params['ForegroundColor'] = "DarkBlue"; $start = "[.]" }
            1 { $Params['ForegroundColor'] = "DarkGreen"; $start = "[-]" }
            2 { $Params['ForegroundColor'] = "DarkRed"; $start = "[X]" }
            3 { $Params['ForegroundColor'] = "DarkRed"; $start = "[XX] Exiting with error: " }
            default { $Params['ForegroundColor'] = "Gray"; $start = "" }
        }
    }
    if ($outputlevel -eq 0) {
        $CallStack = Get-PSCallStack
        if ($CallStack.Count -gt 1) {
            $CallingFunctionName = $CallStack[1].FunctionName
            $functionName = " <$($CallingFunctionName)>"
        }
        else {
            $functionName = " <Called Directly>"
        }
        $start = "$start$functionName"
    }
    # Format the command to show on screen if user wants to see it
    if ($run -and $showCommands) { $showcmd = " [ $run ] " }
    if ($currentLogEntry) { $screenOutput = "$content$showcmd" } else { $screenOutput = "   $start $content$showcmd" }
    if ($append) { $Params['NoNewLine'] = $true; $script:currentLogEntry = "$script:currentLogEntry $content$showcmd"; }
    if (-not $append) {
        #This is the last item in-line.  Write it out if log exists
        if ($logFile) {
            "$(get-date -format "yyyy-MM-dd HH:mm:ss"): $currentLogEntry $content$showcmd" | out-file $logFile -Append
        }
        #Reset inline recording
        $script:currentLogEntry = $null
    }
    # output if user wants to see this level of content
    if ($type -ge $outputLevel) {
        write-host @Params $screenOutput
    }
    if ($whatIf) { return }
    if ($run -and $errorSuppression -and $outputSuppression) { return invoke-expression $run 1>$null }
    if ($run -and $errorSuppression) { return invoke-expression $run 2>$null }
    if ($run -and $outputSuppression) { 
        if ($run.substring(0,6) -eq "gcloud") {
            #Add Google's custom output suppression
            $run = $run + " --no-user-output-enabled"
        }
        return invoke-expression $run 1>$null 
    }
    # If this is a terminal error, write environment variable for Harness to use and exit
    if ($type -eq 3) {
        $env:terminalError = $content
        Send-Update -t 2 -c "Error written to environment variable: terminalError"
        exit
    }
    if ($run) { return invoke-expression $run }
}
function Test-PreFlight {
    # Make sure commands needed are available
    # TODO add aws and azure commands when finished
    if (Get-Command gcloud -ErrorAction SilentlyContinue) {
        Send-Update -t 1 -c "gcloud commands available!"
    }
    else {
        Send-Update -t 3 -c "gcloud commands not found. install via mac with: brew install --cask google-cloud-sdk"
    }
    # Check if using cloudsdk but there is a normal user account.  Switch if so.
    $currentUser = gcloud auth list --format='value(account)' --filter=status=active
    $harnessUser = gcloud auth list --filter=account:'harness.io' --format='value(account)'
    if ($currentUser.contains("cloudsdk") -and $harnessUser.count -eq 1) {
        gcloud config set account $harnessUser --no-user-output-enabled
    }
    
}
function Save-Event {
    # Save event details to google cloud
    Set-Prefs -k "EventCreateTime" -v $(Get-Date).AddHours($timeOffset)
    $datePrefix = $(Get-Date -Uformat "%Y-%m")
    $fileName = $config.GoogleUser.split("@")[0] + "-" + $config.GoogleEventName + ".json"
    gcloud storage cp $configFile gs://harnesseventsdata/events/open/$datePrefix-$fileName --no-user-output-enabled

}
function Save-OutputVariables {
    # Save details as environment variables to use later
    foreach ($item in $config.psobject.members | Where-Object { $_.MemberType -eq 'NoteProperty' }) {
        if (test-path -path Env:$($item.Name)) { Remove-Item Env:$($item.Name) }
        New-Item -Path Env:$($item.Name) -Value $item.Value
    }
}

## Actions
function Invoke-Create {
    Send-Update -t 1 -c "Setting up config for new event."
    # Error out with any problems
    $ErrorActionPreference = "Stop"
    # Use cli provided instructor name if present
    $cliUser = gcloud auth list --format='value(account)' --filter=status=active
    Set-Prefs -k "CLIUser" -v $cliUser
    if ($instructorName) {
        $currentUser = $instructorName
    }
    else {
        # this will use the cloudsdk account- typically used for daily testing
        $currentUser = $cliUser
    }
    if (-not $currentUser) {
        Send-Update -t 2 -c "No google user authentication found.  Is it illegal in 23 US states to continue without one.  Nice try though."
        Send-Update -t 3 -c "Run <gcloud auth login> and login with your work email."
    }
    # Make sure user isn't trying to run this as cloudsdk
    if ($currentUser.Contains("cloudsdk")) {
        Send-Update -t 2 -c "You're running as the HarnessEvents CloudSDK service account."
        Send-Update -t 3 -c "Switch to your work account with <gcloud config set account 'your email'>"
    }
    Send-Update -t 0 -c "Successfully identified current user: $currentUser"
    # Start saving configuration
    Set-Prefs -k "GoogleUser" -v $currentUser
    Set-Prefs -k "InstructorEmail" -v "$($currentUser.split("@")[0])@harnessevents.io"
    # Set user count
    if ($userCount) { Set-Prefs -k "UserEventCount" -v $userCount }
    else { Set-Prefs -k "UserEventCount" -v 1 }
    # Set event name
    if (-not $eventName) {
        $eventName = Get-UserName
        Send-Update -t 1 -c "Generated event name: $eventName" 
    }
    $formattedEventName = $eventName -replace '\W', ''
    $formattedEventName = "event-" + $formattedEventName.tolower()
    Set-Prefs -k "GoogleEventName" -v $formattedEventName
    # Save Harness org name
    Set-Prefs -k "HarnessOrg" -v "$($config.GoogleEventName.tolower().replace("-","_"))"
    $eventEmail = $formattedEventName + "@harnessevents.io"
    Set-Prefs -k "GoogleEventEmail" -v $eventEmail
    if ($gcp) { Set-Prefs -k "GoogleClassroom" -v $config.HarnessOrg.replace("_","-") }
    if ($aws) { Set-Prefs -k "AwsClassroom" -v $config.HarnessOrg.replace("_","-") }
    if ($azure) { Set-Prefs -k "AzureClassroom" -v $config.HarnessOrg.replace("_","-") }
    # Get Access tokens / set headers for assorted systems
    Get-GoogleAccessToken
    Get-HarnessAdminCredentials
    if ($action -eq "reload") {
        Send-Update -t 1 -c "Reload done!"
        exit
    }
    # Create account if requested
    if ($newAccount) {
        $harnessToken = Add-Account -accountName $newAccount
    }
    else {
        # -OR- Check connectivity of provided token
        if ($HarnessPAT) {
            Send-Update -t 1 -c "Using provided Harness PAT"
            $harnessToken = $HarnessPAT 
        }
        else {
            # -OR- Use community account
            Send-Update -t 1 -c "Using community Harness Account"
            $harnessToken = $config.HarnessEventsPAT 
        }
    }
    Test-Connectivity -harnessToken $harnessToken | Out-Null
    # Add licenses if required
    Add-Licenses
    # Save event details to 'open' events json folder
    Save-Event
    # Create the event
    New-Event
    Sync-Event
    Save-OutputVariables
    Disable-ServiceAccount
    Send-Update -t 1 -c "End Create Mode"
    exit
}
function Invoke-Janitor {
    $cliUser = gcloud auth list --format='value(account)' --filter=status=active
    $allUsers = gcloud auth list --format='value(account)' --filter='-ACCOUNT:-compute'
    Set-Prefs -k "CLIUser" -v $cliUser -o
    # Use cli provided instructor name if present
    if ($instructorName) {
        $currentUser = $instructorName
    }
    else { 
        # this will use the cloudsdk account- typically used for daily testing
        $currentUser = gcloud auth list --format='value(account)' --filter=status=active
    }
    if (-not $currentUser) {
        Send-Update -t 2 -c "No google user authentication found.  It is illegal in 23 US states to continue without one.  Nice try though."
        Send-Update -t 2 -c "Run <gcloud auth login> and login with your work email."
        exit
    }
    # Make sure user isn't trying to run this as cloudsdk
    if ($currentUser.Contains("cloudsdk") -and $allUsers.count -gt 1) {
        Send-Update -t 2 -c "You're running as the HarnessEvents CloudSDK service account."
        Send-Update -t 2 -c "Switch to your work account with <gcloud config set account 'your email'>"
        exit
    }
    Enable-ServiceAccount
    Set-Prefs -k "GoogleUser" -v $currentUser
    Set-Prefs -k "InstructorEmail" -v "$($currentUser.split("@")[0])@harnessevents.io"
    Send-Update -t 1 -c "Running event cleanup"
    $validEvents = @()
    $expiredOrgs = @()
    $validGCPProjects = @()
    $validAWSProjects = @()
    $validAzureProjects = @()
    Get-GoogleAccessToken
    # Load all open events
    $openEvents = gcloud storage ls gs://harnesseventsdata/events/open/*.json --verbosity=none
    # Check event for expiration based on time (-hourLimit flag) or user
    foreach ($eventJson in $openEvents) {
        $removeEvent = $false
        $warnEvent = $false
        $e = gcloud storage cat $eventJson | ConvertFrom-Json
        if (-not $e.EventCreateTime) {
            $removeEvent = $true
        }
        $TimeDiff = $(Get-Date) - $e.EventCreateTime
        if ($hourLimit) {
            $eventAge
            if ($TimeDiff.TotalHours -gt $hourLimit) {
                $removeEvent = $true
                Send-Update -t 1 -c "Event $($e.GoogleEventName) has EXPIRED at $([Math]::Round($TimeDiff.Totalhours,2)) hours old <Max age is: $hourLimit>" 
            }
            elseif ($TimeDiff.TotalHours -ge $hourLimit * .75) {
                $warnEvent = $true
                Send-Update -t 1 -c "Event $($e.GoogleEventName) reached 75% time limit at $([Math]::Round($TimeDiff.Totalhours,2)) hours old [75% age is: $($hourLimit * .75)]"
            }
            else {
                Send-Update -t 1 -c "Event $($e.GoogleEventName) is valid at $([Math]::Round($TimeDiff.Totalhours,2)) hours old [Max age is: $hourLimit]"
            }
        }
        else {
            if ($e.InstructorEmail -eq $config.InstructorEmail) {
                $removeEvent = $true
                Send-Update -t 1 -c "Event $($e.GoogleEventName) is one of your events marked to remove."
            }
            else {
                Send-Update -t 1 -c "Skipping even $($e.GoogleEventName)- it's owned by $($e.InstructorEmail)."
            }
        }
        if ($removeEvent) {
            if ($e.HarnessAccount -and $e.HarnessOrg -and $e.HarnessAccountId -and $e.HarnessPat -and $e.HarnessEnv) {
                $expiredOrgs += [PSCustomObject]@{
                    account = $e.HarnessAccount
                    org     = $e.HarnessOrg
                    id      = $e.HarnessAccountId
                    pat     = $e.HarnessPat
                    env     = $e.HarnessEnv
                    creator = $e.GoogleUser
                }
                Send-Update -t 1 -c "Added $($e.HarnessOrg) in $($e.HarnessAccount) to expired events."
            }
            else {
                Send-Update -t 2 -c "Gross! One of these was missing- account: $($e.HarnessAccount) org: $($e.HarnessOrg) id: ($e.HarnessAccountId) pat: $($e.HarnessPat) env: $($e.HarnessEnv)"
            }
            if (-not $whatif) { gcloud storage mv $eventJson gs://harnesseventsdata/events/closed/$(Split-Path $eventJson -leaf) }
        }
        elseif ($warnEvent) {
            if ($e.HarnessAccount -and $e.HarnessOrg -and $e.HarnessAccountId -and $e.HarnessPat -and $e.HarnessEnv) {
                $warningOrgs += [PSCustomObject]@{
                    account = $e.HarnessAccount
                    org     = $e.HarnessOrg
                    id      = $e.HarnessAccountId
                    pat     = $e.HarnessPat
                    env     = $e.HarnessEnv
                    creator = $e.GoogleUser
                }
                Send-Update -t 1 -c "Added $($e.HarnessOrg) in $($e.HarnessAccount) to events scheduled to expire soon."
            }
            else {
                Send-Update -t 2 -c "Gross! One of these was missing- account: $($e.HarnessAccount) org: $($e.HarnessOrg) id: ($e.HarnessAccountId) pat: $($e.HarnessPat) env: $($e.HarnessEnv)"
            }
        }
        else {
            # Event is still active- record it so we can wipe out any orphans later.
            # That sounded AWFUL.  jeez.  I meant DELETE any events that aren't ATTACHED to anything. #BanJediHateCrimes
            $validEvents += $e.GoogleEventEmail
            $validGCPProjects += $e.HarnessOrg.replace("_","-")
            $validAWSProjects += $e.HarnessOrg.replace("_","-")
            $validAzureProjects += $e.HarnessOrg.replace("_","-")
        }
    }
    Send-Update -t 1 -c "There are $($expiredOrgs.count) expired org(s) to process."
    Send-Update -t 1 -c "There are $($warningOrgs.count) to send warnings about."
    ### Remove expired events & create emailList to notify instructors
    Remove-HarnessEventDetails -accounts $expiredOrgs
    ### Create WarningList to email instructors when events will expire soon
    $WarningList = "none"
    foreach ($eventWarning in $WarningOrgs) {
        if ($WarningList -eq "none") { $WarningList = "" }
        if ($WarningList) {
            $WarningList += ","
        }
        $WarningList += $account.org + ";" + $account.creator
    }
    $Env:WarningList = $WarningList
    # Remove unattached  events
    $eventGroups = Get-UserGroups -allEvents
    Send-Update -t 1 -c "$($validEvents.count) valid / $($eventGroups.count) total events."
    $Env:unattachedEvents = "none"
    foreach ($e in $eventGroups) {
        if ($validEvents -notcontains $e.email) {
            Send-Update -t 1 -c "$($e.email) is no longer valid."
            Remove-Event -email $e.email -id $e.id
            if ($Env:unattachedEvents) { $Env:unattachedEvents += "," }
            $Env:unattachedEvents += $e.email
        }
    }
    #Remove unattached google projects
    $gcpProjects = Get-GCPProjectList
    Send-Update -t 1 -c "$($validGCPProjects.count) valid / $($gcpProjects.count) total google project(s)."
    $Env:unattachedGoogleProjects = "none"
    foreach ($project in $gcpProjects) {
        if ($validGCPProjects -notcontains $project.eventName) {
            Send-Update -t 1 -c "Removing project $($project.name) with google id $($project.projectId)"
            Remove-GCPProject -id $project.projectId
            if ($Env:unattachedGoogleProjects) { $Env:unattachedGoogleProjects += "," }
            $Env:unattachedGoogleProjects += $project.name
        }
    }
    if ($config.GoogleUser.contains("@harness.io")) {
        Send-Update -t 1 -c "Switching to original account" -r "gcloud config set account $($config.GoogleUser) --no-user-output-enabled"
    }
    if ($hourLimit) {
        # If this hour limit based (likely running as the main script), remove any unattached users swimming around the HarnessEvents community account.
        Remove-HarnessUsers
    }
    Send-Update -t 1 -c "Expiring soon events to email instructors: $($Env:WarningList)"
    Send-Update -t 1 -c "Expired events to email instructors: $($Env:EmailList)"
    Send-Update -t 1 -c "Unattached event email removed to notify workshop committee: $($Env:unattachedEvents)"
    Send-Update -t 1 -c "Unattached google projects removed to notify workshop committee: $($Env:unattachedGoogleProjects)"
    Send-Update -t 1 -c "End event cleanup" 
    exit
}

## Event Functions
function Add-EventUsers {
    if (-not $config.UserEventCount) {
        Send-Update -t 1 -c "User count not entered- skipping adding users."
        return
    }
    $counter = 1
    # Get current total
    $startingCount = (Get-GroupMembers -s -groupEmail $config.GoogleEventEmail).memberCount
    $usersNeeded = $config.UserEventCount - $startingCount
    Send-Update -t 1 -c "Group has $startingCount now with goal of $($config.UserEventCount)"
    # Loop to add users if needed
    if ($startingCount -ge $config.UserEventCount) {
        return
    }
    while ($counter -le $usersNeeded) {
        $newUser = $false
        While (-not $newUser) {
            $user = Get-UserName
            $response = Get-User -u $user
            if ($response) {
                # username taken, try again. Thanks, RND!
            }
            else {
                # username is good- add the user then add user to group
                New-User -user "$user@harnessevents.io" | Out-null
                Add-UserToGroup -user "$user@harnessevents.io" -groupEmail $config.GoogleEventEmail | out-null
                Send-Update -t 1 -c "Added user: $user@harnessevents.io"
                $newUser = $true
            }
        }
        $counter++
    }
    Send-Update -t 1 -c "Waiting for all users to be available..."
    $memberCounter = 0
    While ($memberCount -lt $($config.UserEventCount)) {
        $memberCount = (Get-GroupMembers -s -groupEmail $config.GoogleEventEmail).memberCount
        Send-Update -t 1 -c "$memberCount of $($config.UserEventCount)"
        Start-Sleep -s 5
        $memberCounter++
        if ($memberCounter -gt 120) {
            Send-Update -t 3 -c "Something went wrong- users didn't load correctly."
            exit
        }
    }
    Send-Update -t 1 -c "All users added successfully"
}
function Add-UserToGroup {
    param (
        [Parameter(Mandatory = $true)][string] $userEmail,
        [Parameter(Mandatory = $true)][string] $groupEmail,
        [Parameter()][switch] $owner
    )
    # Retrieve group key
    $groupKey = Get-GroupKey -g $groupEmail
    # Build api call for group
    $uri = "https://admin.googleapis.com/admin/directory/v1/groups/$groupKey/members"
    Send-Update -t 0 -c "Email $userEmail being added to Group URI: $uri"
    if ($owner) { $role = "OWNER" } else { $role = "MEMBER" }
    $body = @{
        "email" = $userEmail
        "role"  = $role
    } | ConvertTo-Json
    Send-Update -t 0 -c "Body: $body"
    $response = Invoke-RestMethod -Method 'Post' -ContentType 'application/json' -Uri $uri -Body $body -Headers $headers
    return $response
}
function Disable-ServiceAccount {
    if ($config.GoogleUser.contains("@harness.io")) {
        Send-Update -t 1 -c "Switching to original account" -r "gcloud config set account $($config.GoogleUser) --no-user-output-enabled"
    }
}
function Enable-ServiceAccount {
    $currentUser = gcloud auth list --format='value(account)' --filter=status=active
    if ($currentUser.contains("cloudsdk")) {
        $credentialsJson = Get-Content 'key.json' -Raw | Convertfrom-Json
        Set-Prefs -k "ServiceAccountEmail" -v $credentialsJson.client_email
        $PrivateKey = $credentialsJson.private_key -replace '-----BEGIN PRIVATE KEY-----\n' -replace '\n-----END PRIVATE KEY-----\n' -replace '\n'
        Set-Prefs -k "ServiceAccountKey" -v $PrivateKey
        return
    }
    if ($currentUser.contains("@harness.io")) {
        $initProject = gcloud projects list --filter='name:sales' --format=json | Convertfrom-Json
    }
    else {
        $initProject = gcloud projects list --filter='name:administration' --format=json | Convertfrom-Json
    }
    if ($initProject.count -ne 1) {
        Send-Update -t 3 -c "Failed to find project. Try running (gcloud auth login) using your work email."
    }
    Send-Update -t 1 -c "Retrieving credentials" -r "gcloud secrets versions access latest --secret='HarnessEventsAccount' --project=$($initProject.projectId)" | Out-File -FilePath harnessevents.json
    if (!(Test-Path("harnessevents.json"))) {
        Send-Update -t 3 -c "HarnessEventsAccount not found. You might need to run 'gcloud auth login' again with your work email."
    }
    Send-Update -t 1 -c "Activating service account" -r "gcloud auth activate-service-account --key-file=harnessevents.json --no-user-output-enabled"
    $credentialsJson = Get-Content 'harnessevents.json' -Raw | Convertfrom-Json
    Set-Prefs -k "ServiceAccountEmail" -v $credentialsJson.client_email
    $PrivateKey = $credentialsJson.private_key -replace '-----BEGIN PRIVATE KEY-----\n' -replace '\n-----END PRIVATE KEY-----\n' -replace '\n'
    Set-Prefs -k "ServiceAccountKey" -v $PrivateKey
    if ((Test-Path("harnessevents.json"))) {
        Remove-Item -path "harnessevents.json"
    }
}
function Get-Allusers {
    Get-GoogleAccessToken
    $uri = "https://admin.googleapis.com/admin/directory/v1/users?domain=harnessevents.io"
    Send-Update -t 1 -c "Retrieving all users"
    $response = Invoke-RestMethod -Method 'Get' -Uri $uri -Headers $headers
    if ($response.users) {
        return $response.users
    }
    return $false
}
function Get-GoogleAccessToken {
    Send-Update -t 1 -c "Checking on token"
    # Check for valid token
    if ($config.GoogleAccessToken -and $config.GoogleAccessTokenTimestamp) {
        # Check if token is over 30m old
        $TimeDiff = $(Get-Date) - $config.GoogleAccessTokenTimestamp
        if ($TimeDiff.TotalMinutes -lt 30) {
            Send-Update -t 0 -c "Google Workspace Token age is OK: $([math]::round($TimeDiff.TotalMinutes))m."
            $script:headers = @{ "Authorization" = "Bearer $($config.GoogleAccessToken)" }
            return
        }
        else {
            Send-Update -t 1 -c "Google Workspace Token is too old: $([math]::round($TimeDiff.TotalMinutes))m."
        }
    }
    else {
        Send-Update -t 1 -c "Token or timestemp missing."
    }
    # Refresh token if older than 30m
    Send-Update -t 1 -c "Refreshing token"
    Enable-ServiceAccount
    $project = gcloud projects list --filter='name:administration' --format=json | Convertfrom-Json
    Set-Prefs -k "AdminProjectId" -v $($project.projectId)
    # Sneak in grabbing the Harness Feature Flag token and HarnessEvents PATeven though this is a google function. shhhhh!
    if (-not $config.HarnessFFToken) {
        $HarnessFFToken = Send-Update -t 1 -c "Retrieving credentials" -r "gcloud secrets versions access latest --secret='HarnessEventsFF' --project=$($config.AdminProjectId)" 
        Set-Prefs -k "HarnessFFToken" -v $HarnessFFToken
    }
    if (-not $config.HarnessEventsPAT) {
        $HarnessEventsPAT = Send-Update -t 1 -c "Snagging HarnessEvents PAT" -r "gcloud secrets versions access latest --secret='HarnessEventsPAT' --project=$($config.AdminProjectId)"
        Set-Prefs -k "HarnessEventsPAT" -v $HarnessEventsPAT
    }
    $authorizationCode = Send-Update -t 1 -c "Retrieving account token" -r "gcloud auth print-access-token --scopes='https://www.googleapis.com/auth/admin.directory.user https://www.googleapis.com/auth/admin.directory.group'"
    if ($authorizationCode) {
        # Save valid token
        Set-Prefs -k "GoogleAccessToken" -v $authorizationCode
        Set-Prefs -k "GoogleAccessTokenTimestamp" -v $(Get-date)
        # Save the name of the google account to use later
        $googleServiceAccount = gcloud auth list --filter=status:ACTIVE --format='value(account)'
        Set-Prefs -k "GoogleServiceAccount" -v $googleServiceAccount
        # Write out auth headers that can be used anywhere
        $script:headers = @{
            "Authorization" = "Bearer $($config.GoogleAccessToken)"
        }
        Send-Update -t 0 -c "Successfully retrieved a new token and timestamp."
    }
    else {
        Send-Update -t 2 -c "Unexpected error while retrieving access token."
    }
    # Weird issues with project errors even when specifying project in cases where "cached" project was removed.  I hate you, Google.
    gcloud config set project $config.AdminProjectId --no-user-output-enabled
    # Cleanup due to Google's stupid requirement that the json be an actual *file*.  Eat it, Google.
    if (Test-Path -Path harnessevents.json) { Remove-Item harnessevents.json }
    # Get API token to access Google Drive and Google Sheets
    Get-GoogleApiAccessToken
}
function Get-GoogleApiAccessToken {
    if ($config.GoogleAppToken -and $config.GoogleAppTokenTimestamp) {
        # Check if token is over 50m old
        $TimeDiff = $(Get-Date) - $config.GoogleAppTokenTimestamp
        if ($TimeDiff.TotalMinutes -lt 30) {
            $script:appHeaders = @{
                "Authorization"       = "Bearer $($config.GoogleAppToken)"
                "x-goog-user-project" = $($config.AdminProjectId)
            }
            Send-Update -t 0 -c "Google App Token age is OK: $([math]::round($TimeDiff.TotalMinutes))m."
            return
        }
        else {
            Send-Update -t 1 -c "Google App Token is too old: $([math]::round($TimeDiff.TotalMinutes))m."
        }
    }
    else {
        Send-Update -t 1 -c "New token needed"
    }
    $PrivateKey = $config.ServiceAccountKey
    $header = @{
        alg = "RS256"
        typ = "JWT"
    }
    $headerBase64 = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes(($header | ConvertTo-Json)))
    $timestamp = [Math]::Round((Get-Date -UFormat %s))
    $claimSet = @{
        iss   = $config.ServiceAccountEmail
        scope = "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets"
        aud   = "https://oauth2.googleapis.com/token"
        exp   = $timestamp + 3600
        iat   = $timestamp
        # sub   = $TargetUserEmail
    }
    $claimSetBase64 = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes(($claimSet | ConvertTo-Json)))
    $signatureInput = $headerBase64 + "." + $claimSetBase64
    $signatureBytes = [System.Text.Encoding]::UTF8.GetBytes($signatureInput)
    $privateKeyBytes = [System.Convert]::FromBase64String($PrivateKey)
    $rsaProvider = [System.Security.Cryptography.RSA]::Create()
    $bytesRead = $null
    $rsaProvider.ImportPkcs8PrivateKey($privateKeyBytes, [ref]$bytesRead)
    $signature = $rsaProvider.SignData($signatureBytes, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $signatureBase64 = [System.Convert]::ToBase64String($signature)
    $jwt = $headerBase64 + "." + $claimSetBase64 + "." + $signatureBase64
    $body = @{
        grant_type = "urn:ietf:params:oauth:grant-type:jwt-bearer"
        assertion  = $jwt
    }
    $response = Invoke-RestMethod -Uri "https://oauth2.googleapis.com/token" -Method POST -Body $body -ContentType "application/x-www-form-urlencoded"
    $script:appHeaders = @{
        Authorization         = 'Bearer {0}' -f $response.access_token
        "x-goog-user-project" = $($config.AdminProjectId)
    }
    # Save valid token
    Set-Prefs -k "GoogleAppToken" -v $response.access_token
    Set-Prefs -k "GoogleAppTokenTimestamp" -v $(Get-date)
}
function Get-GroupKey {
    # Google requires GroupKey for API calls- retrieve the key from the group name
    param (
        [string] $GroupEmail
    )
    $uri = "https://admin.googleapis.com/admin/directory/v1/groups?domain=harnessevents.io&query=email='$GroupEmail'"
    Send-Update -t 0 -c "Looking up key with uri: $uri"
    $response = Invoke-RestMethod -Method 'Get' -Uri $uri -Headers $headers
    if ($response.groups.id) {
        Send-Update -t 0 -c "Group ID retrieved: $($response.groups.id)"
        return $response.groups.id
    }
    else {
        Send-Update -t 2 -c "NO ID found for URI: $uri"
    }
}
function Get-GroupMembers {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string] $groupEmail,
        [Parameter()]
        [switch] $splitIntoGroups # organize the results into owners/members and provide a count
    )
    # Retrieve group key - or use cached default if none provided
    $groupKey = Get-GroupKey -g $groupEmail
    $uri = "https://admin.googleapis.com/admin/directory/v1/groups/$groupKey/members"
    Send-Update -t 0 -c "Getting group members with uri: $uri"
    $response = Invoke-RestMethod -Method 'Get' -Uri $uri -Headers $headers
    if ($response.members) {
        if ($splitIntoGroups) {
            $groupMembers = @{
                "owners"      = $response.members | Where-Object { $_.role -eq "OWNER" }
                "members"     = $response.members | Where-Object { $_.role -eq "MEMBER" }
                "ownerCount"  = ($response.members | Where-Object { $_.role -eq "OWNER" }).count
                "memberCount" = ($response.members | Where-Object { $_.role -eq "MEMBER" }).count
                "groupKey"    = $groupKey
            }
            return $groupMembers
        }
        else {
            return $response.members
        }
        
    }
    return $false
}
function Get-User {
    [CmdletBinding()]
    param (
        [Parameter()]
        [string]
        $userName
    )
    if (!$userName.contains("harnessevents.io")) { $userName = "$userName@harnessevents.io" }
    $uri = "https://admin.googleapis.com/admin/directory/v1/users?domain=harnessevents.io&query=email='$userName'"
    Send-Update -t 0 -c "Looking up user with uri: $uri"
    $response = Invoke-RestMethod -Method 'Get' -Uri $uri -Headers $headers
    if ($response.users) {
        return $response.users
    }
    return $false
}
function Get-UserGroups {
    # Get all groups that a user belongs to
    [CmdletBinding()]
    param (
        [Parameter()]
        [string]
        $UserEmail,
        [Parameter()]
        [switch]
        $allEvents
    )
    if ($UserEmail) {
        $urlFilter = "&userKey=$UserEmail"
    }
    if ($allEvents) {
        $urlFilter = "&query=email:event-*"
    }
    $uri = "https://admin.googleapis.com/admin/directory/v1/groups?domain=harnessevents.io$urlFilter"
    Send-Update -t 0 -c "Getting Usergroups for uri: $uri"
    try {
        $response = Invoke-RestMethod -Method 'Get' -Uri $uri -Headers $headers
    }
    catch {
        Send-Update -t 2 -c "Oh, GOOOOD! : $($_.Exception.Message)"
        return $false
    }
    $response = Invoke-RestMethod -Method 'Get' -Uri $uri -Headers $headers
    return $response.groups
}
function New-Group {
    # Create a new group and confirm it is reachable via API before returning
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string]
        $email,
        [Parameter()]
        [string]
        $name
    )
    if (!$name) { $name = "new-group" }
    $body = @{
        "email" = $email
        "name"  = $name
    } | ConvertTo-Json
    $uri = "https://admin.googleapis.com/admin/directory/v1/groups?domain=harnessevents.io&query=email='$email'"
    Send-Update -t 0 -c "Create new group with uri: $uri"
    $response = Invoke-RestMethod -Method 'Post' -ContentType 'application/json' -Uri $uri -Body $body -Headers $headers
    Send-Update -t 0 -c "Create new group returned: $response"
    $success = $false
    $counter = 0
    Send-Update -t 1 -a -c "Waiting for group creation"
    Do {
        Send-Update -t 1 -a -c "."
        $response = Invoke-RestMethod -Method 'Get' -Uri $uri -Headers $headers
        if ($response.groups) {
            Send-Update -t 1 -c "Group $email created"
            $success = $true
        }
        else {
            $counter++
            if ($counter -gt 120) {
                Send-Update -t 3 -c "Group creation failed after 10 minutes waiting!"
                exit
            }
            Start-sleep -s 5
        }
    } until ($success)
}
function New-Event {
    Send-Update -t 1 -c "Creating new event"
    # Create instructor email for this user if it doesn't exist
    if (!(Get-User -u $config.InstructorEmail)) {
        New-User -u $config.InstructorEmail
        Send-Update -t 1 -c "Generated your instructor email: $($config.InstructorEmail)"  
    }
    # Create group if needed
    $uri = "https://admin.googleapis.com/admin/directory/v1/groups?domain=harnessevents.io&query=email='$($config.GoogleEventEmail)'"
    Send-Update -t 0 -c "Checking group email with uri: $uri"
    $response = Invoke-RestMethod -Method 'Get' -Uri $uri -Headers $headers
    if (!$response.groups) {
        Send-Update -t 0 -c "Group didn't exist. Creating."
        New-Group -e $config.GoogleEventEmail -n $config.GoogleEventName
        Add-UserToGroup -u $config.InstructorEmail -groupEmail $config.GoogleEventEmail -o | out-null
        Send-Update -t 1 -c "Waiting for $($config.InstructorEmail) to be registered as group owner"
        while (-not $groupReady) {
            # Wait until slow ass google registers the new group owner. zzzz.....
            $membershipCheck = (Get-UserGroups -u $config.InstructorEmail | Where-Object { $_.email -eq $config.GoogleEventEmail }).count
            if ($membershipCheck -eq 1) {
                $groupReady = $true
            }
            else {
                Send-Update -t 1 -c "User not yet registered..."
                Start-Sleep -s 6
            }
        }
        Send-Update -t 1 -c "Successfully added user: $($config.InstructorEmail) as owner."
    }
    else {
        # Event already exists- if someone else is trying to overwrite this owner's event, bail out
        Send-Update -t 1 -c "$($config.GoogleEventEmail) already exists.  Confirming ownership."
        $members = Get-GroupMembers -groupEmail $config.GoogleEventEmail -splitIntoGroups
        if (($members.owners.email | Where-Object { $_ -eq $config.GoogleEventEmail }).count -eq 1) {
            Send-Update -t 2 -c "This event is owned by: $($members.owners)- wait for the event to expire or contact the owner."
            exit
        }
        Send-Update -t 1 -c "Confirmed you are an event owner."
    }
    $eventId = Get-GroupKey -g $($config.GoogleEventEmail)
    Set-Prefs -k "GoogleEventId" -v $eventId
}
function New-User {
    # Create a new google workspace user
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string] $userEmail
    )
    $uri = 'https://admin.googleapis.com/admin/directory/v1/users'
    $body = @{
        "primaryEmail"              = $userEmail
        "name"                      = @{
            "givenName"  = "Harness"
            "familyName" = "Events"
        }
        "suspended"                 = $false
        "password"                  = "Harness!"
        "changePasswordAtNextLogin" = $false
    } | ConvertTo-Json
    $response = Invoke-RestMethod -Method 'Post' -ContentType 'application/json' -Uri $uri -Body $body -Headers $headers
    return $response
}
function Remove-Event {
    # V2 = splitting things up for Create mode refactor. leaving V1 for now for script mode
    # This version now only removes the event and user email
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string]
        $email,
        [Parameter(Mandatory = $true)]
        [string]
        $id
    )
    Get-GoogleAccessToken
    $script:HarnessFFHeaders = @{
        'x-api-key'    = $config.HarnessFFToken
        'Content-Type' = 'application/json'
    }
    Send-Update -t 1 -c "Deleting google event $email"
    $members = Get-GroupMembers -s -groupEmail $email
    foreach ($member in $members.members) {
        Remove-User -u $member.email
        Send-Update -t 1 -c "Deleted user: $($member.email)"
    }
    While ($memberCount -gt 0) {
        $memberCount = (Get-GroupMembers -s -groupEmail $email).memberCount
        Send-Update -t 1 -c "Waiting for delete confirmation for $memberCount accounts"
        Start-Sleep -s 4
        $memberCounter++
        if ($memberCounter -gt 20) {
            Send-Update -t 2 -c "Something went wrong- $eventEmail users didn't fully delete."
            exit
        }
    }
    Send-Update -t 0 -c "Successfully deleted users"
    $groupUri = "https://admin.googleapis.com/admin/directory/v1/groups/$($id)"
    $GroupCheckUri = "https://admin.googleapis.com/admin/directory/v1/groups?domain=harnessevents.io&query=email=$($email)"
    if ($whatif) {
        Send-Update -t 1 -c "whatif prevented: Deleting group: $email"
        return
    }
    Send-Update -t 1 -c "Deleting group: $email"
    Invoke-RestMethod -Method 'Delete' -Uri $groupUri -Headers $headers | Out-null
    #Wait for group to be gone
    $counter = 0
    Do {
        $counter++
        if ($counter -ge 30) {
            Send-Update -t 2 -c "Deleting the google group took too long. I'm OUTTA here."
            exit
        }
        Send-Update -t 1 -c "Waiting for group deletion..."
        Send-Update -t 0 -c "Group exists uri: $groupCheckUri"
        $groupExists = Invoke-RestMethod -Method 'GET' -Uri $GroupCheckUri -Headers $headers
        Start-Sleep -s 3
    } until (-not $groupExists.groups)
}
function Remove-User {
    [CmdletBinding()]
    param (
        [Parameter()]
        [string]
        $userEmail
    )
    if ($whatif) {
        Send-Update -t 1 -c "whatif prevented: Removing google user: $userEmail"
    }
    Send-Update -t 1 -c "Removing google user: $userEmail"
    $uri = "https://admin.googleapis.com/admin/directory/v1/users/$userEmail"
    $response = Invoke-RestMethod -Method 'Delete' -Uri $uri -Headers $headers
    return $response

}
function Save-EventDetails {
    Get-GoogleApiAccessToken
    $members = Get-GroupMembers -groupEmail $config.GoogleEventEmail | select-object -property role, email | sort-object -property role -Des
    $attendeeCount = $members.count
    $members | Add-Member -MemberType NoteProperty -Name "password" -Value ""
    $members | Add-Member -MemberType NoteProperty -Name "HarnessLink" -Value ""
    $members | Add-Member -MemberType NoteProperty -Name "LabLink" -Value ""
    # Create array of arrays suitable for dropping into googley sheet
    $orgLink = "https://app.harness.io/ng/account/$($config.HarnessAccountId)/module/cd/orgs/$($config.HarnessOrg)"
    $orgCell = '=HYPERLINK("' + $orgLink + '","Org Link")'
    $exportArray = @()
    $exportArray += ,@("Open this in an incognito window!")
    $exportArray += ,@($config.GoogleEventName, $orgCell)
    $exportArray += ,@(" ")
    $exportArray += ,@("    Class Email Address    ","  Class Password  ","  Direct Project Link  ","  Lab Guide  ","  Your Name  ","  Where are you from?  ","  Vacations-Hot or Cold?  ")
    foreach ($member in $members) {
        $cleanProject = ($member.email.split("@")[0] -replace '\W', '').tolower()
        if ($member.role -eq "MEMBER") {
            $member.role = "Attendee"
            $member.password = "Harness!"
            $member.HarnessLink = "https://app.harness.io/ng/account/$($config.HarnessAccountId)/module/cd/orgs/$($config.HarnessOrg)/projects/$($cleanProject)/pipelines"
            $harnessLink = '=HYPERLINK("' + $($member.HarnessLink) + '","Project Link")'
            $member.LabLink = "https://suchcodewow.io/globalcorp?account=$($config.HarnessAccountId)&org=$($config.HarnessOrg)&project=$($cleanProject)"
            $labLink = '=HYPERLINK("' + $($member.LabLink) + '","Lab Guide")'
            $exportArray += ,@($member.email, $member.password, $harnessLink, $labLink)
        }
        else {
            $member.role = "Instructor"
            $exportArray += ,@($member.email)
        }
    }
    # If there's a google project, generate links for it
    if ($config.GoogleProjectId) {
        $exportArray += ,@(" ")
        $exportArray += ,@("Event Google Project Links")
        $googleKubernetesLink = '=HYPERLINK("https://console.cloud.google.com/kubernetes/list/overview?project=' + $config.GoogleProjectId + '","Kubernetes")'
        $googleArtifactsLink = '=HYPERLINK("https://console.cloud.google.com/artifacts?project=' + $config.GoogleProjectId + '","Artifact Registry")'
        $googleRunLink = '=HYPERLINK("https://console.cloud.google.com/run?project' + $config.GoogleProjectId + '","Cloud Run")'
        $exportArray += ,@($googleKubernetesLink,$googleArtifactsLink,$googleRunLink)
        $GoogleDetails = "`r`n"
        $GoogleDetails += "Google Kubernetes Overview,https://console.cloud.google.com/kubernetes/list/overview?project=$($config.GoogleProjectId)`r`n"
        $GoogleDetails += "Google Artifact Registry,https://console.cloud.google.com/artifacts?project=$($config.GoogleProjectId)`r`n"
        $GoogleDetails += "Google Cloud Run,https://console.cloud.google.com/run?project=$($config.GoogleProjectId)`r`n"
    }
    # TODO Generate links for AWS
    # TODO Generate links for Azure
    # Check if we have consent to write out a google worksheet
    if (-not $config.GoogleAppToken) {
        $members | Format-Table
        $members | Export-Csv "$($config.GoogleEventName).csv"
        $GoogleDetails | Add-Content -Path "$($config.GoogleEventName).csv"
        Send-Update -t 1 -c "Exported --> $($config.GoogleEventName).csv"
        return
    }
    # Get ID of HarnessEvents shared drive
    $uriDrive = "https://www.googleapis.com/drive/v3/drives?supportsAllDrives=true&q=name='HarnessEvents'"
    $drive = Invoke-RestMethod -Method 'GET' -uri $uriDrive -Headers $appHeaders -ContentType "application/json"
    # Get ID of instructor classrooms folder
    $uriEventsFolder = "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=drive&driveId=$($drive.drives.id)&q=mimeType='application/vnd.google-apps.folder' and name='instructor classrooms'"
    $eventsFolder = Invoke-RestMethod -Method 'GET' -uri $uriEventsFolder -Headers $appHeaders -ContentType "application/json"
    # Check if HarnessEvents folder already exists in current user's googley drive- create if needed
    $uri = "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=drive&driveId=$($drive.drives.id)&q=mimeType='application/vnd.google-apps.folder' and name='" + $($config.GoogleUser) + "' and '" + $eventsFolder.files.id + "' in parents"
    Send-Update -t 0 -c "uri to check for google folder: $uri"
    $response = invoke-restmethod -Method 'GET' -uri $uri -Headers $appHeaders -ContentType "application/json"
    if ($response.files) {
        Send-Update -t 0 -c "Google Drive folder already exists- skipping creation"
        $parentFolder = $response.files.id
    }
    else {
        $bodyFolder = @{
            "name"     = $config.GoogleUser
            "mimeType" = "application/vnd.google-apps.folder"
            "parents"  = @(
                $eventsFolder.files.id
            )
        } | ConvertTo-Json
        $folder = invoke-restmethod -Method 'POST' -uri $uri -Headers $appHeaders -body $bodyFolder -ContentType "application/json"
        Send-Update -t 0 -c "Created Google Drive folder: $($config.GoogleUser)"
        $parentFolder = $folder.id
    }
    if (-not $parentFolder) {
        Send-Update -t 2 -c "Failed to create or obtain HarnessEvents Google Folder- skipping google sheet create."
        return
    }
    # We have a valid parent folder- delete old google sheet if present
    $uriFileExists = "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=drive&driveId=$($drive.drives.id)&q='$($parentFolder)' in parents and name='$($config.GoogleEventName)'"
    $responseFileExists = invoke-restmethod -Method 'GET' -headers $appHeaders -uri $uriFileExists
    if ($responseFileExists.files.id) {
        foreach ($fileId in $responseFileExists.files.id) {
            # $fileId = $responseFileExists.files.id
            $uriDelete = "https://www.googleapis.com/drive/v3/files/$($fileId)?supportsAllDrives=true"
            Send-Update -t 0 -c "delete uri: $uriDelete"
            Invoke-RestMethod -method 'Delete' -uri $uriDelete -headers $appHeaders
            Send-Update -t 0 -c "Deleted old file: $fileId"
        }
    }
    $bodyFile = @{
        "name"     = $($config.GoogleEventName)
        "mimeType" = "application/vnd.google-apps.spreadsheet"
        parents    = @(
            $parentFolder
        )
    } | ConvertTo-Json
    $responseSheets = invoke-restmethod -Method 'POST' -uri $uri -Headers $appHeaders -body $bodyFile -ContentType "application/json"
    if (-not $responseSheets.id) {
        Send-Update -t 2 -c "Failed to create $($config.GoogleEventName) Google Sheet"
        return
    }
    else {
        $fileId = $responseSheets.id
    }
    # Clear data from spreadsheet
    $uriClear = "https://sheets.googleapis.com/v4/spreadsheets/$($fileId)/values/A1:Z1000:clear"
    invoke-restmethod -Method 'POST' -uri $uriClear -Headers $appHeaders | Out-Null
    # Add Data to spreadsheet
    $uriSheet = "https://sheets.googleapis.com/v4/spreadsheets/$fileId/values/A1?valueInputOption=USER_ENTERED"
    $bodySheet = @{
        "values" = $exportArray
    } | ConvertTo-Json
    invoke-restmethod -Method 'PUT' -uri $uriSheet -Headers $appHeaders -body $bodySheet -ContentType "application/json" | Out-null
    # Autosize Columns
    $uriResize = "https://sheets.googleapis.com/v4/spreadsheets/$($fileId):batchUpdate"
    $bodyResize = @{
        "requests" = @(
            ,@{
                "repeatCell" = @{
                    "range"  = @{
                        "sheetId"       = 0
                        "startRowIndex" = 3
                        "endRowIndex"   = 4
                    }
                    "cell"   = @{
                        "userEnteredFormat" = @{
                            "backgroundColor"     = @{
                                "red"   = 0.471
                                "green" = 0.565
                                "blue"  = 0.612
                            }
                            "horizontalAlignment" = "CENTER"
                            "textFormat"          = @{
                                "foregroundColor" = @{
                                    "red"   = 1.0
                                    "green" = 1.0
                                    "blue"  = 1.0
                                }
                                "fontSize"        = 12
                                "bold"            = $true
                            }
                        }
                    }
                    "fields" = "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)"
                }
            }
            ,@{
                "repeatCell" = @{
                    "range"  = @{
                        "sheetId"          = 0
                        "startRowIndex"    = 5 + $attendeeCount
                        "endRowIndex"      = 6 + $attendeeCount
                        "startColumnIndex" = 0
                        "endColumnIndex"   = 1
                    }
                    "cell"   = @{
                        "userEnteredFormat" = @{

                            "textFormat" = @{
                                "foregroundColor" = @{
                                    "red"   = 1.0
                                    "green" = 0.671
                                    "blue"  = 0.251
                                }
                                "fontSize"        = 12
                                "bold"            = $true
                            }
                        }
                    }
                    "fields" = "userEnteredFormat(textFormat,horizontalAlignment)"
                }
            }
            ,@{
                "autoResizeDimensions" = @{
                    "dimensions" = @{
                        "sheetId"    = 0
                        "dimension"  = "COLUMNS"
                        "startIndex" = 0
                        "endIndex"   = 10
                    }
                }
            }
        )
    } | ConvertTo-Json -Depth 20
    invoke-restmethod -Method 'POST' -uri $uriResize -body $bodyResize -Headers $appHeaders -ContentType "application/json" | out-Null
    Send-Update -t 1 -c "-------------------------------------------------------"
    Send-Update -t 1 -c "Your event has been updated:  https://docs.google.com/spreadsheets/d/$($fileId)"
    #Send-Update -t 1 -c "Or open your Google Drive and navigate to: <your drive>/HarnessEvents/$($config.GoogleEventName)"
    Set-Prefs -k "EventLink" -v "https://docs.google.com/spreadsheets/d/$($fileId)"
    Save-Event
}
function Sync-Event {
    $script:HarnessHeaders = @{
        'x-api-key'    = $config.HarnessPAT
        'Content-Type' = 'application/json'
    }
    $script:HarnessFFHeaders = @{
        'x-api-key'    = $config.HarnessFFToken
        'Content-Type' = 'application/json'
    }
    #Confirm required values exist
    if (-not $config.GoogleEventName) {
        Send-Update -t 3 -c "GoogleEventName was blank.  (That shouldn't happen)"
    }
    if (-not $config.HarnessPAT -or -not $config.HarnessAccountId -or -not $config.HarnessAccount) {
        Send-Update -t 3 -c "Harness token, AccountId, and Account Name are required to setup an event (That shouldn't happen)"
    }
    if (-not $config.HarnessOrg) {
        Send-Update -t 3 -c "Harness Org must be set (that shouldn't happen)"
    }
    Add-EventUsers
    Add-HarnessEventDetails
    if ($config.GoogleClassroom) { New-GCPProject }
    if ($config.AwsClassroom) { New-AWSProject }
    if ($config.AzureClassroom) { New-AzureProject }
    Add-Variables
    Save-EventDetails
}

## Harness Functions
function Add-Account {
    [CmdletBinding()]
    param (
        [Parameter()]
        [string]
        $accountName
    )
    Send-Update -t 1 -c "Adding new account: $accountName"
    ### Pull credential details
    $startDate = [System.DateTimeOffset]::new( (Get-Date) ).ToUnixTimeSeconds() * 1000
    $expirationDate = [System.DateTimeOffset]::new( (Get-Date).AddDays(30)).ToUnixTimeSeconds() * 1000
    $harnessEventsEmail = Send-Update -t 1 -c "Retrieving Harness Admin Email" -r "gcloud secrets versions access latest --secret='HarnessEventsEmail' --project=$($config.AdminProjectId)"
    $harnessEventsPassword = Send-Update -t 1 -c "Retrieving Harness Admin Password" -r "gcloud secrets versions access latest --secret='HarnessEventsPassword' --project=$($config.AdminProjectId)"
    ### Get bearer token and account details
    $uriBearer = "https://app.harness.io/gateway/api/users/login"
    $credential = "$($harnessEventsEmail):$harnessEventsPassword"
    $Bytes = [System.Text.Encoding]::UTF8.GetBytes($credential)
    $EncodedText = [Convert]::ToBase64String($Bytes)
    $script:bodyBearer = @{
        "authorization" = "Basic $EncodedText"
    } | ConvertTo-Json
    Try {
        $response = invoke-restmethod -Method Post -body $bodyBearer -uri $uriBearer -ContentType 'application/json'
    }
    Catch {
        if ($_.Exception.Response.StatusCode -eq "Forbidden") {
            Send-Update -t 3 -c "Got 403 forbidden access Harness. Connect to VPN to continue."
        }
        write-host $_.ErrorDetails
    }
    $bearerToken = $response.resource.token
    $parentIdentifier = $response.resource.uuid
    $accountList = $response.resource.accounts
    ### Check if company name already managed by harnessevents
    $managedAccountDetails = $accountList | where-object { $_.accountName -eq $accountName }
    if ($managedAccountDetails) {
        Set-Prefs -k "HarnessAccount" -v $managedAccountDetails.accountName
        Set-Prefs -k "HarnessAccountId" -v $managedAccountDetails.uuid
        Send-Update -t 1 -c "An account with this name is already being managed by HarnessEvents. Using $($config.HarnessAccountId)"
        if ($managedAccountDetails.status -ne "ACTIVE") {
            Send-Update -t 3 -c "The account $($accountObject.uuid) is not active (current status: $($managedAccountDetails.status)). Please choose a different account name or change the account to 'ACTIVE'."
        }
    }
    else {
        ### Create new account
        $uri = "https://admin.harness.io/api/accounts/v2"
        $body = @{
            "accountName"    = $accountName
            "companyName"    = $accountName
            "adminUserEmail" = $harnessEventsEmail
            "accountStatus"  = "ACTIVE"
            "accountType"    = "PAID"
            "clusterType"    = "PAID"
            "clusterId"      = "prod1"
            "licenseUnits"   = 100
            "expiryTime"     = $expirationDate
            "nextGenEnabled" = $true
        } | Convertto-Json
        Send-Update -t 1 -c "Creating account: $accountName"
        Try {
            $accountObject = invoke-restmethod -Method Post -body $body -Headers $harnessAdminHeaders -uri $uri -ContentType application/json
        }
        catch {
            if ($_.Exception.Response.StatusCode -eq "Forbidden") {
                Send-Update -t 3 -c "Got 403 forbidden access Harness. Connect to VPN to continue."
            }
            write-host $_.ErrorDetails
        }
        Set-Prefs -k "HarnessAccount" -v $accountObject.accountName
        Set-Prefs -k "HarnessAccountId" -v $accountObject.uuid
        
    }
    ### Get new bearer token for newly created account
    $uriAccountBearer = "https://app.harness.io/gateway/api/users/login?accountId=$($config.HarnessAccountId)"
    Send-Update -t 1 -c "Retrieve new bearer token for account: $($config.HarnessAccount)."
    Try {
        $response = invoke-restmethod -Method Post -body $bodyBearer -uri $uriAccountBearer -ContentType 'application/json'
    }
    Catch {
        if ($_.Exception.Response.StatusCode -eq "Forbidden") {
            Send-Update -t 3 -c "Got 403 forbidden access Harness. Connect to VPN to continue."
        }
        write-host $_.ErrorDetails
    }
    $bearerToken = $response.resource.token
    $script:parentIdentifier = $response.resource.uuid
    ### Get existing API keys
    $script:headerApiKey = @{
        "Authorization" = "Bearer $bearerToken"
    }
    $tokenDeleteUri = "https://app.harness.io/gateway/ng/api/token/harnesseventstoken?routingId=$($config.HarnessAccountId)&accountIdentifier=$($config.HarnessAccountId)&apiKeyType=USER&parentIdentifier=$parentIdentifier&apiKeyIdentifier=harnesseventskey"
    Send-Update -t 0 -c "Deleting old token if it exists with: $tokenDeleteUri"
    Try {
        Invoke-RestMethod -method Delete -uri $tokenDeleteUri -headers $headerApiKey | out-null
    }
    catch {

    }
    # Create the Token
    $bodyToken = @{
        "identifier"        = "harnesseventstoken"
        "name"              = "harnesseventstoken"
        "description"       = ""
        "accountIdentifier" = $($config.HarnessAccountId)
        "apiKeyType"        = "USER"
        "apiKeyIdentifier"  = "harnesseventskey"
        "parentIdentifier"  = $parentIdentifier
        "expiry"            = "-1"
        "validTo"           = 4102376400000
        "validFrom"         = $startDate

    } | Convertto-Json
    $headerToken = @{
        "authorization" = "Bearer $bearerToken"
    }
    $uriToken = "https://app.harness.io/ng/api/token?accountIdentifier=$($config.HarnessAccountId)"
    Send-Update -t 1 -c "Creating harnessevents api token."
    $script:responseToken = invoke-restmethod -Method Post -body $bodyToken -uri $uriToken -Headers $headerToken -ContentType 'application/json'
    return $responseToken.data
}
function Add-AttendeeRole {
    $uri = "https://app.harness.io/v1/orgs/$($config.HarnessOrg)/roles"
    $body = @{
        "identifier"  = "attendeeRole"
        "name"        = "attendeeRole"
        "permissions" = @(
            "idp_scorecard_view"
            "idp_scorecard_edit"
            "idp_scorecard_delete"
            "idp_layout_view"
            "idp_layout_edit"
            "idp_integration_view"
            "idp_integration_create"
            "idp_integration_edit"
            "idp_integration_delete"
            "core_environment_view"
            "core_environment_access"
            "core_environmentgroup_view"
            "core_environmentgroup_access"
            "core_governancePolicy_view"
            "core_governancePolicySets_evaluate"
            "core_governancePolicy_edit"
            "core_governancePolicySets_edit"
            "core_service_view"
            "core_service_access"
            "core_template_view"
            "core_template_access"
            "core_secret_view"
            "core_secret_access"
            "core_connector_view"
            "core_connector_access"
            "core_file_view"
            "core_file_access"
            "core_dashboards_view"
            "core_delegate_view"
            "core_delegateconfiguration_view"
        )
    } | Convertto-Json
    try {
        Invoke-RestMethod -Method 'POST' -ContentType "application/json" -uri $uri -Headers $HarnessHeaders -body $body | out-null
    }
    catch {
        $errorResponse = $_ | Convertfrom-Json
        if ($errorResponse.code -eq "DUPLICATE_FIELD") {
            Send-Update -t 1 -c "AttendeeRole already exists."
        }
        else {
            Send-Update -t 2 -c "Faied to create organization with error: $errorResponse"
            exit
        }
    }
}
function Add-CodeRepos {
    $repositories = Get-Content -Path "./harnesseventsdata/config/project/cr.json" | Convertfrom-Json
    $attendees = (Get-GroupMembers -groupEmail $config.GoogleEventEmail -s).members
    foreach ($attendee in $attendees) {
        $projectName = $attendee.email.split("@")[0]
        foreach ($repository in $repositories) {
            Send-Update -t 1 -c "Adding $($repository.HarnessName) to project $projectName"
            $uri = "https://app.harness.io/code/api/v1/repos/import?accountIdentifier=$($config.HarnessAccountId)&orgIdentifier=$($config.HarnessOrg)&projectIdentifier=$projectName"
            $codeheaders = @{
                'x-api-key' = $config.HarnessPAT
            }
            $body = @{
                "description"   = ""
                "identifier"    = $repository.HarnessName
                "parent_ref"    = $config.harnessAccountID + "/" + $config.HarnessOrg + "/" + $projectName
                "pipelines"     = "ignore"
                "provider"      = @{
                    "host"     = ""
                    "password" = ""
                    "type"     = "github"
                    "username" = ""
                }
                "provider_repo" = $repository.SourceRepo
                #"uid"           = "string"
            } | Convertto-Json
            Try {
                invoke-restmethod -Method Post -uri $uri -headers $codeheaders -body $body -ContentType "application/json" | out-null
            }
            catch {
                if ($_.Exception.Message.contains("Conflict")) {
                    Send-Update -t 1 -c "Repo already exists"
                }
                else {
                    send-Update -t 2 -c "Error adding repository: $($_.Exception.Message)"
                }
            }
        }
    }
}
function Add-Delegate {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string]
        $delegatePrefix #expecting gcp/az/aws
    )
    $delegateName = $delegatePrefix + "-delegate-" + $($config.HarnessOrg.replace("_","-"))
    #Check if there was an existing delegate
    Send-Update -t 1 -c "Checking for existing delegate"
    $delegateStatus = Get-DelegateStatus
    $delegateAvailable = $delegateStatus | where-object { $_.name -eq $delegateName }
    if ($delegateAvailable) {
        Send-Update -t 1 -c "$delegateName already exists and is connected. Skipping creation."
        return
    }
    # Check for disconnected delegate by tag lookup
    $uriTags = "https://app.harness.io/ng/api/delegate-group-tags/delegate-groups?accountIdentifier=$($config.HarnessAccountId)&orgIdentifier=$($config.HarnessOrg)"
    $bodyTags = @{
        "tags" = @(
            $delegateName
        )
    } | Convertto-Json
    try {
        $response = Invoke-RestMethod -method 'POST' -uri $uriTags -headers $HarnessHeaders -body $bodyTags -ContentType 'application/json'
    }
    catch {
        Send-update -t 0 -c "no delegate exists."
    }
    if ($response.resource) {
        Send-Update -t 1 -c "Deleting disconnected/old delegate by id: $($response.resource.identifier)"
        Remove-Delegate -delegateId $response.resource.identifier
    }
    Send-Update -t 0 -c "Current delegate found: $delegateStatus"
    if ($delegateStatus -and $delegateStatus.name.contains($delegateName)) {
        #Remove-Delegate -delegatePrefix $delegatePrefix
        Send-Update -t 1 -c "Delegate: $delegateName already exists. Skipping create."
        return
    }
    Send-Update -t 1 -c "Get $delegateName Delegate Config" -r "Get-DelegateConfig -d $delegateName"
    Send-Update -t 1 -o -c "Apply $delegateName delegate yaml" -r "kubectl apply -f $delegateName.yaml"
    if (test-path -Path "$delegateName.yaml") { Remove-Item "$delegateName.yaml" }
    $counter = 0
    Do {
        Send-Update -t 1 -c "Waiting for delegate to be available..."
        $delegateStatus = Get-DelegateStatus
        $delegateAvailable = $delegateStatus | where-object { $_.name -eq $delegateName }
        $counter++
        if ($counter -ge 10) {
            Send-Update -t 2 -c "Sorry... delegate did not load correctly."
            exit
        }
        Start-sleep -s 20
    } While (-not $delegateAvailable)
    Send-Update -t 1 -c "$DelegatePrefix Delegate is connected and ready!"
}
function Add-Filter {
    [CmdletBinding()]
    param (
        [Parameter()]
        [string]
        $filterType, #Connector, Template, Secret known so far (api reference is blank- fun!)
        [string]
        $name
    )
    # Need to use a combination of documented and undocumented API's here. It's ok though.  I'm all cried out at this point.
    # The API can't hurt me any more.
    Switch ($filterType) {
        "Connector" {
            $uri = "https://app.harness.io/ng/api/filters?accountIdentifier=$($config.HarnessAccountId)"
        }
        "Template" {
            $uri = "https://app.harness.io/template/api/filters?accountIdentifier=$($config.HarnessAccountId)"
        }
        default {
            Send-Update -t 0 -c "$filterType is unsupported. Can't add $name"
        }
    }
    $body = @{
        "name"             = $name
        "identifier"       = $name
        "orgIdentifier"    = $config.HarnessOrg
        "filterVisibility" = "EveryOne"
        "filterProperties" = @{
            "connectorNames"       = @()
            "connectorIdentifiers" = @()
            "filterType"           = $filterType
            "tags"                 = @{
                $name = ""
            }
        }
    } | ConvertTo-Json -Depth 5
    $body1 = @{
        filterVisibility = "EveryOne"
        identifier       = "gcp"
        orgIdentifier    = "event_builder"
        name             = "gcp"
        filterProperties = @{
            tags                 = @{
                gcp = ""
            }
            connectorNames       = @()
            connectorIdentifiers = @()
            filterType           = "Template"
        }
    } | ConvertTo-Json -Depth 5
    $templateheaders = @{
        'x-api-key' = $config.HarnessPAT
    }
    Try {
        Invoke-RestMethod -uri $uri -body $body -Method 'POST' -headers $templateheaders -ContentType "application/json" | Out-null
    }
    Catch {
        $errorResponse = $_ | Convertfrom-Json
        if ($errorResponse.code -eq "DUPLICATE_FIELD") {
            Send-Update -t 1 -c "Filter $name already exists in org $($config.HarnessOrg)."
        }
        else {
            Send-Update -t 2 -c "uri attempted was: $uri"
            Send-Update -t 2 -c "body was: $body"
            Send-Update -t 2 -c "Failed to create filter with error: $errorResponse"
            write-host $body1
            exit
        }  
    }
}
function Add-HarnessAdmin {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string]
        $userEmail
    )
    $uri = "https://app.harness.io/ng/api/user/users?accountIdentifier=$($config.HarnessAccountId)"
    $body = @{
        "emails"       = @(
            $userEmail
        )
        "roleBindings" = @(
            @{
                "roleIdentifier"          = "_account_admin"
                "roleName"                = "Account Admin"
                "roleScopeLevel"          = "account"
                "resourceGroupIdentifier" = "_all_resources_including_child_scopes"
                "managedRole"             = $false
            }
        )
    } | Convertto-Json
    Invoke-RestMethod -Method 'POST' -uri $uri -body $body -headers $HarnessHeaders -ContentType "application/json" | out-null
    Send-Update -t 1 -c "Added $userEmail to account admin role."
}
function Add-HarnessEventDetails {
    # This step does a bunch of things right now (maybe break it down?)
    # It will:
    #   enable the feature flags at ./harnesseventsdata/config/featureflagstart.json
    #   add filters listed at ./harnesseventsdata/config/filters.json
    #   enable google-auth in oauth settings and create an attendee role
    #   load all secrets starting with 'org' from google secret manager
    #   load all templates found in ./harnesseventsdata/OrgTemplates/*.yaml
    #   add the organization for the chosen event, add projects for everyone, and add users to the attendee role

    # Add needed flags
    $featureFlagsStart = Get-Content -path ./harnesseventsdata/config/featureflagsstart.json | Convertfrom-Json
    $currentFlags = Get-FeatureFlagStatus
    $flagsNeeded = Compare-Object @($featureFlagsStart.PSObject.Properties) @($currentFlags.PSObject.Properties) -Property Name, Value | Where-Object { $_.SideIndicator -eq "<=" }
    Send-Update -t 1 -c "$($flagsNeeded.count) flag(s) to update"
    foreach ($flag in $flagsNeeded) {
        $ffSuccess = Update-FeatureFlag -flag $flag.Name -value $flag.Value
        if (-not $ffSuccess) {
            # this flag failed- likely because it no longer exists. Removing it from the desired feature flags list.
            Send-Update -t 0 -c "Removing failed feature flag $($flag.name) from the list to update"
            $featureFlagsStart.PSObject.Properties.Remove($flag.Name)
        }
    }
    do {
        $currentFlags = Get-FeatureFlagStatus
        $flagsNeeded = Compare-Object @($featureFlagsStart.PSObject.Properties) @($currentFlags.PSObject.Properties) -Property Name, Value | Where-Object { $_.SideIndicator -eq "<=" }
        Send-Update -t 1 -c "Waiting for $($flagsNeeded.count) flag(s)..."
        Start-Sleep -s 2
    } until (-not $flagsNeeded)
    #Enable Google Auth for attendee access & Org level bits
    Enable-GoogleAuth
    Add-Organization
    # Add filters to make it easier to find stuff
    $filters = Get-Content -path ./harnesseventsdata/config/filters.json | Convertfrom-Json
    foreach ($filterObject in $filters.psobject.Properties.name) {
        foreach ($filter in $filters.$filterObject) {
            #write-host "type $filterObject name $filter"
            Add-Filter -filterType $filterObject -name $filter
        }
    }
    # Add secrets from google secret manager
    Add-OrgSecrets
    # Add everything in order from the 'org' folder
    $OrgContent = Get-Childitem -path ./harnesseventsdata/org -attributes D
    foreach ($folder in $OrgContent) {
        Add-OrgYaml -YamlFolder "$folder/*.yaml"
    }
    Add-Policies
    Add-AttendeeRole
    $attendees = Get-GroupMembers -groupEmail $config.GoogleEventEmail
    $attendees += [PSCustomObject]@{"email" = $config.GoogleUser; "role" = "OWNER" }
    foreach ($attendee in $attendees) {
        if ($attendee.role -eq "OWNER") {
            # if user is an owner, they are a Harness SE- so grant account admin
            Add-HarnessAdmin -userEmail $attendee.email
        }
        else {
            # If user is not an owner, then it is an attendee email- give them a project and attendee permissions
            $cleanProject = ($attendee.email.split("@")[0] -replace '\W', '').tolower()
            Add-Project -projectName $cleanProject
            Add-HarnessUser -projectName $cleanProject -userEmail $attendee.email
        }
    }
    Add-CodeRepos
}
function Add-HarnessUser {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string]
        $userEmail,
        [Parameter(Mandatory = $true)]
        [string]
        $projectName
    )
    # Check if user already exists
    $userExists = Get-HarnessUser -e $userEmail
    if ($userExists) {
        Send-Update -t 1 -c "$userEmail already exists.  Skipping create."
    }
    else {
        # Create user account
        do {
            # Loop until valid Org User
            $uri1 = "https://app.harness.io/ng/api/user/users?accountIdentifier=$($config.HarnessAccountId)&orgIdentifier=$($config.HarnessOrg)"
            $body1 = @{
                "emails"       = @(
                    $userEmail
                )
                "roleBindings" = @(
                    @{
                        "roleIdentifier"          = "attendeeRole"
                        "roleName"                = "attendeeRole"
                        "roleScopeLevel"          = "organization"
                        "resourceGroupIdentifier" = "_all_organization_level_resources"
                        "resourceGroupName"       = "All Organization Level Resources"
                        "managedRole"             = $false 
                    }
                )
            } | Convertto-Json
            Invoke-RestMethod -Method 'POST' -uri $uri1 -body $body1 -headers $HarnessHeaders -ContentType "application/json" | out-null
            $activeUser = Get-HarnessUser -e $userEmail
            if (-not $activeUser) {
                # Make sure the stupid slow flag was active to automatically add user to 'active'
                $pendingUser = Get-PendingUser -e $userEmail
                if ($pendingUser) {
                    Send-Update -t 1 -c "Flag wasn't ready- removing user invite for $userEmail"
                    Remove-PendingUser -inviteId $pendingUser.id
                }
                else {
                    Send-Update -t 1 -c "Waiting for $userEmail to be available"
                }
                Start-Sleep -s 2
            }
        } until ($activeUser)
        # Add user at Project level
        $uri = "https://app.harness.io/ng/api/user/users?accountIdentifier=$($config.HarnessAccountId)&orgIdentifier=$($config.HarnessOrg)&projectIdentifier=$projectName"
        $body = @{
            "emails"       = @(
                $userEmail
            )
            "roleBindings" = @(
                @{
                    "roleIdentifier"          = "_project_admin"
                    "roleName"                = "Project Admin"
                    "roleScopeLevel"          = "project"
                    "resourceGroupIdentifier" = "_all_project_level_resources"
                    "managedRole"             = $false
                }
            )
        } | Convertto-Json
        Invoke-RestMethod -Method 'POST' -uri $uri -body $body -headers $HarnessHeaders -ContentType "application/json" | out-null
       
        Send-Update -t 1 -c "Added $userEmail to $projectName project admin and $($config.HarnessOrg) attendeeRole."
    }
}
function Add-Licenses {
    $startDate = [System.DateTimeOffset]::new( (Get-Date) ).ToUnixTimeSeconds() * 1000
    $expirationDate = [System.DateTimeOffset]::new( (Get-Date).AddDays(30)).ToUnixTimeSeconds() * 1000
    # OMG Why do 2 Harness API's use DIFFERENT strings to describe the SAME ENVIRONMENT *internal sobbing*
    $fixGodDamnEnv = $config.HarnessEnv.tolower()
    $accountSummaryUri = "https://admin.harness.io/api/accounts/summary/$($config.HarnessAccountId)?clusterId=$fixGodDamnEnv&clusterType=PAID"
    Send-Update -t 0 -c "checking account summary with uri: $accountSummaryUri"
    Try {
        $response = invoke-restmethod -Method Get -Headers $harnessAdminHeaders -uri $accountSummaryUri -ContentType "application/json"
    }
    catch {
        if ($_.Exception.Response.StatusCode -eq "Forbidden") {
            Send-update -t 2 -c "Can't reach admin.harness.io (likely VPN not enabled). Skipping license creation- this could have unexpected results."
            return
        }

    }
    $currentLicenses = $response.allModuleLicenses
    $uriLicense = "https://admin.harness.io/api/accounts/$($config.HarnessAccountId)/ng/license?clusterId=$fixGodDamnEnv&clusterType=PAID"

    if ($currentLicenses.CD.status -eq "EXPIRED") {
        Send-Update -t 3 -c "CD license exists but EXPIRED. Delete or update license to be active."
    }
    if ($currentLicenses.CD.status -ne "ACTIVE") {
        $bodyCDLicense = @{
            "moduleType"            = "CD"
            "licenseType"           = "PAID"
            "edition"               = "ENTERPRISE"
            "accountIdentifier"     = $($config.HarnessAccountId)
            "startTime"             = $startDate
            "expiryTime"            = $expirationDate
            "status"                = "ACTIVE"
            "premiumSupport"        = true
            "selfService"           = true
            "developerLicenseCount" = 100
            "cdLicenseType"         = "DEVELOPER_360"
        } | Convertto-Json
        Send-Update -t 1 -c "Adding CD License"
        invoke-restmethod -Method Put -body $bodyCDLicense -Headers $harnessAdminHeaders -uri $uriLicense -ContentType "application/json" | Out-Null
    }
    else { Send-Update -t 1 -c "Account already has a CD license, skipping." }

    if ($currentLicenses.CI.status -eq "EXPIRED") {
        Send-Update -t 3 -c "CI license exists but EXPIRED. Delete or update license to be active."
    }
    if ($currentLicenses.CI.status -ne "ACTIVE") {
        $bodyCILicense = @{
            "moduleType"            = "CI"
            "licenseType"           = "PAID"
            "edition"               = "ENTERPRISE"
            "accountIdentifier"     = $($config.HarnessAccountId)
            "startTime"             = $startDate
            "expiryTime"            = $expirationDate
            "status"                = "ACTIVE"
            "premiumSupport"        = true
            "selfService"           = true
            "developerLicenseCount" = 100
        } | Convertto-Json
        Send-Update -t 1 -c "Adding CI License"
        invoke-restmethod -Method Put -body $bodyCILicense -Headers $harnessAdminHeaders -uri $uriLicense -ContentType "application/json" | Out-Null
    }
    else { Send-Update -t 1 -c "Account already has a CI license, skipping." }

    if ($currentLicenses.IACM.status -eq "EXPIRED") {
        Send-Update -t 3 -c "IACM license exists but EXPIRED. Delete or update license to be active."
    }
    if ($currentLicenses.IACM.status -ne "ACTIVE") {
        $bodyIACMLicense = @{
            "moduleType"            = "IACM"
            "licenseType"           = "PAID"
            "edition"               = "ENTERPRISE"
            "accountIdentifier"     = $($config.HarnessAccountId)
            "startTime"             = $startDate
            "expiryTime"            = $expirationDate
            "status"                = "ACTIVE"
            "premiumSupport"        = true
            "selfService"           = true
            "developerLicenseCount" = 100
        } | Convertto-Json
        Send-Update -t 1 -c "Adding IACM License"
        invoke-restmethod -Method Put -body $bodyIACMLicense -Headers $harnessAdminHeaders -uri $uriLicense -ContentType "application/json" | Out-Null
    }
    else { Send-Update -t 1 -c "Account already has an IACM license, skipping." }

    if ($currentLicenses.CHAOS.status -eq "EXPIRED") {
        Send-Update -t 3 -c "CHAOS license exists but EXPIRED. Delete or update license to be active."
    }
    if ($currentLicenses.CHAOS.status -ne "ACTIVE") {
        $bodyCHAOSLicense = @{
            "moduleType"            = "CHAOS"
            "licenseType"           = "PAID"
            "edition"               = "ENTERPRISE"
            "accountIdentifier"     = $($config.HarnessAccountId)
            "startTime"             = $startDate
            "expiryTime"            = $expirationDate
            "status"                = "ACTIVE"
            "premiumSupport"        = true
            "selfService"           = true
            "developerLicenseCount" = 100
            "chaosLicenseType"      = "DEVELOPER_360"
            "secondaryEntitlement"  = 33
        } | Convertto-Json
        Send-Update -t 1 -c "Adding CHAOS License"
        invoke-restmethod -Method Put -body $bodyCHAOSLicense -Headers $harnessAdminHeaders -uri $uriLicense -ContentType "application/json" | Out-Null
    }
    else { Send-Update -t 1 -c "Account already has a CHAOS license, skipping." }

    if ($currentLicenses.IDP.status -eq "EXPIRED") {
        Send-Update -t 3 -c "IDP license exists but EXPIRED. Delete or update license to be active."
    }
    if ($currentLicenses.IDP.status -ne "ACTIVE") {
        $bodyIDPLicense = @{
            "moduleType"            = "IDP"
            "licenseType"           = "PAID"
            "edition"               = "ENTERPRISE"
            "accountIdentifier"     = $($config.HarnessAccountId)
            "startTime"             = $startDate
            "expiryTime"            = $expirationDate
            "status"                = "ACTIVE"
            "premiumSupport"        = true
            "selfService"           = true
            "developerLicenseCount" = 100
        } | Convertto-Json
        Send-Update -t 1 -c "Adding IDP License"
        invoke-restmethod -Method Put -body $bodyIDPLicense -Headers $harnessAdminHeaders -uri $uriLicense -ContentType "application/json" | Out-Null
    }
    else { Send-Update -t 1 -c "Account already has a IDP license, skipping." }

    if ($currentLicenses.STO.status -eq "EXPIRED") {
        Send-Update -t 3 -c "STO license exists but EXPIRED. Delete or update license to be active."
    }
    if ($currentLicenses.STO.status -ne "ACTIVE") {
        $bodySTOLicense = @{
            "moduleType"            = "STO"
            "licenseType"           = "PAID"
            "edition"               = "ENTERPRISE"
            "accountIdentifier"     = $($config.HarnessAccountId)
            "startTime"             = $startDate
            "expiryTime"            = $expirationDate
            "status"                = "ACTIVE"
            "premiumSupport"        = true
            "selfService"           = true
            "developerLicenseCount" = 100
        } | Convertto-Json
        Send-Update -t 1 -c "Adding STO License"
        invoke-restmethod -Method Put -body $bodySTOLicense -Headers $harnessAdminHeaders -uri $uriLicense -ContentType "application/json" | Out-Null
    }
    else { Send-Update -t 1 -c "Account already has a STO license, skipping." }

    if ($currentLicenses.SSCA.status -eq "EXPIRED") {
        Send-Update -t 3 -c "SSCA license exists but EXPIRED. Delete or update license to be active."
    }
    if ($currentLicenses.SSCA.status -ne "ACTIVE") {
        $bodySSCALicense = @{
            "moduleType"            = "SSCA"
            "licenseType"           = "PAID"
            "edition"               = "ENTERPRISE"
            "accountIdentifier"     = $($config.HarnessAccountId)
            "startTime"             = $startDate
            "expiryTime"            = $expirationDate
            "status"                = "ACTIVE"
            "premiumSupport"        = true
            "selfService"           = true
            "developerLicenseCount" = 100
            "numberOfExecutions"    = 10000
        } | Convertto-Json
        Send-Update -t 1 -c "Adding SSCA License"
        invoke-restmethod -Method Put -body $bodySSCALicense -Headers $harnessAdminHeaders -uri $uriLicense -ContentType "application/json" | Out-Null
    }
    else { Send-Update -t 1 -c "Account already has a SSCA license, skipping." }

    if ($currentLicenses.HAR.status -eq "EXPIRED") {
        Send-Update -t 3 -c "HAR license exists but EXPIRED. Delete or update license to be active."
    }
    if ($currentLicenses.HAR.status -ne "ACTIVE") {
        $bodyHARLicense = @{
            "moduleType"             = "HAR"
            "licenseType"            = "PAID"
            "edition"                = "ENTERPRISE"
            "accountIdentifier"      = $($config.HarnessAccountId)
            "startTime"              = $startDate
            "expiryTime"             = $expirationDate
            "status"                 = "ACTIVE"
            "premiumSupport"         = true
            "selfService"            = true
            "maxStorageSizeInString" = "1GiB"
        } | Convertto-Json
        Send-Update -t 1 -c "Adding HAR License"
        invoke-restmethod -Method Put -body $bodyHARLicense -Headers $harnessAdminHeaders -uri $uriLicense -ContentType "application/json" | Out-Null
    }
    else { Send-Update -t 1 -c "Account already has a HAR license, skipping." }

    if ($currentLicenses.DBOPS.status -eq "EXPIRED") {
        Send-Update -t 3 -c "DBOPS license exists but EXPIRED. Delete or update license to be active."
    }
    if ($currentLicenses.DBOPS.status -ne "ACTIVE") {
        $bodyDBOPSLicense = @{
            "moduleType"        = "DBOPS"
            "licenseType"       = "PAID"
            "edition"           = "ENTERPRISE"
            "accountIdentifier" = $($config.HarnessAccountId)
            "startTime"         = $startDate
            "expiryTime"        = $expirationDate
            "status"            = "ACTIVE"
            "premiumSupport"    = true
            "selfService"       = true
            "instanceCount"     = 100
        } | Convertto-Json
        Send-Update -t 1 -c "Adding DBOPS License"
        invoke-restmethod -Method Put -body $bodyDBOPSLicense -Headers $harnessAdminHeaders -uri $uriLicense -ContentType "application/json" | Out-Null
    }
    else { Send-Update -t 1 -c "Account already has a DBOPS license, skipping." }

    if ($currentLicenses.FME.status -eq "EXPIRED") {
        Send-Update -t 3 -c "FME license exists but EXPIRED. Delete or update license to be active."
    }
    if ($currentLicenses.FME.status -ne "ACTIVE") {
        $bodyDBOPSLicense = @{
            "moduleType"             = "FME"
            "licenseType"            = "PAID"
            "edition"                = "ENTERPRISE"
            "accountIdentifier"      = $($config.HarnessAccountId)
            "startTime"              = $startDate
            "expiryTime"             = $expirationDate
            "status"                 = "ACTIVE"
            "premiumSupport"         = true
            "selfService"            = true
            "numberOfDevelopers"     = 100
            "numberOfEventsEntitled" = 1000000
            "numberOfMTKsEntitled"   = 1000000
        } | Convertto-Json
        Send-Update -t 1 -c "Adding FME License"
        invoke-restmethod -Method Put -body $bodyDBOPSLicense -Headers $harnessAdminHeaders -uri $uriLicense -ContentType "application/json" | Out-Null
    }
    else { Send-Update -t 1 -c "Account already has a FME license, skipping." }
}
function Add-Organization {
    $harnessOrg = $config.HarnessOrg
    $body = @{
        "organization" = @{
            "identifier" = $harnessOrg
            "name"       = $harnessOrg
        }
    } | Convertto-Json
    $uri = "https://app.harness.io/ng/api/organizations?accountIdentifier=$($config.HarnessAccountId)"
    try {
        Invoke-RestMethod -Method 'POST' -ContentType "application/json" -uri $uri -Headers $HarnessHeaders -body $body | Out-Null
    }
    catch {
        $errorResponse = $_ | Convertfrom-Json
        if ($errorResponse.code -eq "DUPLICATE_FIELD") {
            Send-Update -t 1 -c "Organization $harnessOrg already exists."
        }
        else {
            Send-Update -t 2 -c "Failed to create organization with error: $errorResponse"
            exit
        }
    }
}
function Add-OrgSecrets {
    # Load all secrets from administration secret manager
    $orgSecrets = Send-Update -t 1 -c "Get secrets to install" -r "gcloud secrets list --project=$($config.AdminProjectId) --filter='name ~ org*' --format='value(NAME)'"
    foreach ($secret in $orgSecrets) {
        $secretValue = gcloud secrets versions access latest --secret=$secret --project=$($config.AdminProjectId)
        $ContentType = "application/json"
        $secretID = $secret.substring(3)
        $secretName = $secretID.replace("_"," ")
        $templateheaders = @{
            'x-api-key' = $($config.HarnessPAT)
        }
        $body = @{
            secret = @{
                type          = "SecretText"
                name          = $secretName
                identifier    = $secretID
                orgIdentifier = $($config.HarnessOrg)
                spec          = @{
                    errorMessageForInvalidYaml = "string"
                    secretManagerIdentifier    = "org.harnessSecretManager"
                    type                       = "SecretTextSpec1"
                    valueType                  = "Inline"
                    value                      = $secretValue
                }
            }
        } | Convertto-Json
        $uri = "https://app.harness.io/ng/api/v2/secrets?accountIdentifier=$($config.HarnessAccountId)&orgIdentifier=$($config.HarnessOrg)&privateSecret=false"
        Try {
            Send-Update -t 1 -c "Adding/Updating secret: $secretID"
            Invoke-RestMethod -uri $uri -Method 'POST' -headers $templateheaders -ContentType $contentType -body $body | Out-Null
        }
        Catch {
            $errorResponse = $_ | Convertfrom-Json
            if ($errorResponse.message.contains("already exists")) {
                Send-Update -t 0 -c "Secret: $secretID already exists."
            }
            else {
                Send-Update -t 2 -c "Failed to create template: $templateId  with error: $errorResponse.message"
                Send-Update -t 2 -c "Uri was: $uri"
                Send-Update -t 2 -c "Body was: $body"
                #exit
            }   
        }
    }
}
function Add-OrgYaml {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string]
        $YamlFolder
    )
    # This is currently a bit complex.  There are several yaml types in Harness that use aaaalllllmost the same
    # api structure.  Right now this function is identifying the type from the first line of yaml and then handling
    # multiple scenarios.
    $OrgTemplates = Get-ChildItem -path $YamlFolder
    foreach ($yaml in $OrgTemplates) {
        $modifiedTemplate = ""
        $templateId = (split-path $yaml -Leaf).split(".")[0]
        $templateName = $templateId.Replace("_"," ")
        $template = Get-Content -path $yaml
        # There are multiple endpoints for essentially the same yaml.  Identify the type when it appears in the yaml
        # then setup the API requirements that team thought would be fun the day they designed their endpoint in a vacuum.
        $templateFirstLine = $template[0].trim()
        switch ($templateFirstLine) {
            "template:" {
                $modifiedTemplate += "$templateFirstLine`r`n"
                $modifiedTemplate += "  name: $templateName`r`n"
                $modifiedTemplate += "  identifier: $templateId`r`n"
                $modifiedTemplate += "  versionLabel: ""1""`r`n"
                $modifiedTemplate += "  orgIdentifier: $($config.HarnessOrg)`r`n"
                $uri = "https://app.harness.io/template/api/templates?storeType=INLINE&accountIdentifier=$($config.HarnessAccountId)&orgIdentifier=$($config.HarnessOrg)"
                $contentType = "application/json"
                $templateType = "template"
            }
            "connector:" {
                $modifiedTemplate += "$templateFirstLine`r`n"
                $modifiedTemplate += "  name: $templateName`r`n"
                $modifiedTemplate += "  identifier: $templateId`r`n"
                $modifiedTemplate += "  versionLabel: ""1""`r`n"
                $modifiedTemplate += "  orgIdentifier: $($config.HarnessOrg)`r`n"
                $uri = "https://app.harness.io/ng/api/connectors?accountIdentifier=$($config.HarnessAccountId)&orgIdentifier=$($config.HarnessOrg)"
                $contentType = "text/yaml"
                $templateType = "connector"
            }
            "service:" {
                $modifiedTemplate += "$templateFirstLine`r`n"
                $modifiedTemplate += "  name: $templateName`r`n"
                $modifiedTemplate += "  identifier: $templateId`r`n"
                $modifiedTemplate += "  orgIdentifier: $($config.HarnessOrg)`r`n"
                $uri = "https://app.harness.io/ng/api/servicesV2?accountIdentifier=$($config.HarnessAccountId)&orgIdentifier=$($config.HarnessOrg)"
                $contentType = "application/json"
                $templateType = "service"
            }
            "environment:" {
                $modifiedTemplate += "$templateFirstLine`r`n"
                $modifiedTemplate += "  name: $templateName`r`n"
                $modifiedTemplate += "  identifier: $templateId`r`n"
                $modifiedTemplate += "  orgIdentifier: $($config.HarnessOrg)`r`n"
                $uri = "https://app.harness.io/ng/api/environmentsV2?accountIdentifier=$($config.HarnessAccountId)&orgIdentifier=$($config.HarnessOrg)"
                $contentType = "application/json"
                $templateType = "environment"
            }
            "infrastructureDefinition:" {
                $modifiedTemplate += "$templateFirstLine`r`n"
                $modifiedTemplate += "  name: $templateName`r`n"
                $modifiedTemplate += "  identifier: $templateId`r`n"
                $modifiedTemplate += "  orgIdentifier: $($config.HarnessOrg)`r`n"
                $uri = "https://app.harness.io/ng/api/infrastructures?accountIdentifier=$($config.HarnessAccountId)"
                $contentType = "application/json;charset=utf-8"
                $templateType = "infrastructureDefinition"
            }
            default {
                Send-Update -t 0 -c "Unknown template type $templateId with first line of $templateFirstLine"
                break
            }
        }
        # Load all remaining lines except the ones updated above.
        foreach ($line in $template | Select-Object -skip 1) {
            $addThisLine = $true
            # Ignore any of these situations
            if ($line.length -ge 7 -and $line.substring(0,7) -eq "  name:") {
                $addThisLine = $false
            }
            if ($line.length -ge 13 -and $line.substring(0,13) -eq "  identifier:") {
                $addThisLine = $false
            }
            if ($line.length -ge 15 -and $line.substring(0,15) -eq "  versionLabel:") {
                $addThisLine = $false
            }
            if ($line.length -ge 16 -and $line.substring(0,16) -eq "  orgIdentifier:") {
                $addThisLine = $false
            }
            if ($line.length -ge 20 -and $line.substring(0,20) -eq "  projectIdentifier:") {
                $addThisLine = $false
            }
            if ($addThisLine) {
                $modifiedTemplate += "$line`r`n"
            }
        }
        $templateheaders = @{
            'x-api-key' = $config.HarnessPAT
        }
        # It's insane, but some API calls require duplicating values both in yaml and in body (????).. 
        # so add more duplicate unecessary logic... and then have a little cry.
        switch ($templateFirstLine) {
            "service:" {
                $body = @{
                    "name"          = $templateName
                    "identifier"    = $templateId
                    "orgIdentifier" = $config.HarnessOrg
                    "yaml"          = $modifiedTemplate
                } | Convertto-Json
            }
            "environment:" {
                $body = @{
                    "name"          = $templateName
                    "identifier"    = $templateId
                    "orgIdentifier" = $config.HarnessOrg
                    "type"          = "Production"
                    "yaml"          = $modifiedTemplate
                } | Convertto-Json
            }
            "infrastructureDefinition:" {
                $body = @{
                    "yaml" = $modifiedTemplate
                } | ConvertTo-Json
            }
            default {
                $body = $modifiedTemplate
            }
        }
        Try {
            Send-Update -t 1 -c "Adding/Updating org $($templateType): $templateId"
            Invoke-RestMethod -uri $uri -body $body -Method 'POST' -headers $templateheaders -ContentType $contentType | Out-null
        }
        Catch {
            # Generates a System.Management.Automation.ErrorRecord
            if ($_.Exception.Response.StatusCode.value__ -ne 401) {
                $errorResponse = $_ | Convertfrom-Json
                if ($errorResponse.message.contains("already exists")) {
                    Send-Update -t 0 -c "Template: $templateId already exists."
                }
                else {
                    Send-Update -t 2 -c "Failed to create template: $templateId with error: $errorResponse.message"
                    Send-Update -t 0 -c "URI: $uri"
                    Send-Update -t 0 -c "ContentType: $contentType"
                    Send-Update -t 0 -c "Headers: $($templateheaders | Select-Object -Property *)"
                    Send-Update -t 0 -c "template yaml:"
                    Send-Update -t 0 -c $body
                }  
            }
            else {
                Send-Update -t 2 -c "Failed to create template: $templateId. 401: $_)"
                Send-Update -t 0 -c "URI: $uri"
                Send-Update -t 0 -c "ContentType: $contentType"
                Send-Update -t 0 -c "Headers: $($templateheaders | Select-Object -Property *)"
                Send-Update -t 0 -c "template yaml:"
                Send-Update -t 0 -c $body
            }
        }
    }
}
function Add-Policies {
    # Install all policies
    $uri = "https://app.harness.io/pm/api/v1/policies?accountIdentifier=$($config.HarnessAccountId)&orgIdentifier=$($config.HarnessOrg)"
    $orgPolicies = Get-ChildItem -path ./harnesseventsdata/Policies/*.policy 
    foreach ($policy in   $orgPolicies) {
        $policyId = (split-path $policy -Leaf).split(".")[0]
        $policyName = $policyId.Replace("_"," ")
        $policyContent = Get-Content $policy | Out-String
        $body = @{
            "name"       = $policyName
            "identifier" = $policyId
            "rego"       = $policyContent
        } | ConvertTo-Json
        Send-Update -t 1 -c "Adding/Updating policy $policyName"
        Try {
            Invoke-Restmethod -method 'POST' -uri $uri -body $body -ContentType "application/json" -headers $HarnessHeaders | Out-Null
            
        }
        Catch {
            # Generates a System.Management.Automation.ErrorRecord
            if ($_.Exception.Response.StatusCode.value__ -ne 401) {
                $errorResponse = $_ | Convertfrom-Json
                if ($errorResponse.message.contains("policy identifier must be unique")) {
                    Send-Update -t 0 -c "Policy: $policyId already exists."
                }
                else {
                    Send-Update -t 2 -c "Failed to create policy: $policyId with error: $errorResponse.message"
                    Send-Update -t 0 -c "URI: $uri"
                    Send-Update -t 0 -c "ContentType: $contentType"
                    Send-Update -t 0 -c "Headers: $($templateheaders | Select-Object -Property *)"
                    Send-Update -t 0 -c "template yaml:"
                    Send-Update -t 0 -c $body
                }  
            }
            else {
                Send-Update -t 2 -c "Failed to create policy: $policyId. 401: $_)"
                Send-Update -t 0 -c "URI: $uri"
                Send-Update -t 0 -c "ContentType: $contentType"
                Send-Update -t 0 -c "Headers: $($templateheaders | Select-Object -Property *)"
                Send-Update -t 0 -c "template yaml:"
                Send-Update -t 0 -c $body
            }
        }
    }
    # Then install policysets using ID's of created policies
    $uriPolicyset = "https://app.harness.io/gateway/pm/api/v1/policysets?accountIdentifier=$($config.HarnessAccountId)&orgIdentifier=$($config.HarnessOrg)"
    $policySets = Get-ChildItem -path ./harnesseventsdata/Policies/*.policyset
    foreach ($policyset in $policySets) {
        $setId = (split-path $policyset -Leaf).split(".")[0]
        $setName = $setId.Replace("_"," ")
        $setContent = Get-Content $policyset | Convertfrom-Json
        $setBody = @{
            "name"       = $setName
            "identifier" = $setId
            "action"     = "onsave"
            "enabled"    = $false
            "type"       = "pipeline"
            "policies"   = @(
                $setContent
            )
        } | ConvertTo-Json
        Send-Update -t 1 -c "Adding/Updating policyset: $setName"
        Try {
            Invoke-Restmethod -method 'POST' -uri $uriPolicyset -body $setBody -ContentType "application/json" -headers $HarnessHeaders | Out-Null

        }
        Catch {
            # Generates a System.Management.Automation.ErrorRecord
            if ($_.Exception.Response.StatusCode.value__ -ne 401) {
                $errorResponse = $_ | Convertfrom-Json
                if ($errorResponse.message.contains("policy set identifier must be unique")) {
                    Send-Update -t 0 -c "Policy set: $setId already exists."
                }
                else {
                    Send-Update -t 2 -c "Failed to create policy set: $setId with error: $errorResponse.message"
                    Send-Update -t 0 -c "URI: $uri"
                    Send-Update -t 0 -c "ContentType: $contentType"
                    Send-Update -t 0 -c "Headers: $($templateheaders | Select-Object -Property *)"
                    Send-Update -t 0 -c "template yaml:"
                    Send-Update -t 0 -c $body
                }  
            }
            else {
                Send-Update -t 2 -c "Failed to create policy set: $setId. 401: $_)"
                Send-Update -t 0 -c "URI: $uri"
                Send-Update -t 0 -c "ContentType: $contentType"
                Send-Update -t 0 -c "Headers: $($templateheaders | Select-Object -Property *)"
                Send-Update -t 0 -c "template yaml:"
                Send-Update -t 0 -c $body
            }
        }
    }
}
function Add-Project {
    # Create a project and optionally add an administrator
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string]
        $projectName,
        [Parameter()]
        [string]
        $admin
    )
    $body = @{
        "project" = @{
            "orgIdentifier" = $config.HarnessOrg
            "identifier"    = $cleanProject
            "name"          = $cleanProject
        }
    } | Convertto-Json
    $uri = "https://app.harness.io/ng/api/projects?accountIdentifier=$($config.HarnessAccountId)&orgIdentifier=$($config.HarnessOrg)"
    try {
        Invoke-RestMethod -Method 'POST' -ContentType "application/json" -uri $uri -Headers $HarnessHeaders -body $body | out-null
    }
    catch {
        $errorResponse = $_ | Convertfrom-Json
        if ($errorResponse.code -eq "DUPLICATE_FIELD") {
            Send-Update -t 1 -c "Project $projectName already exists in org $($config.HarnessOrg)."
        }
        else {
            Send-Update -t -2 -c "uri attempted was: $uri"
            Send-Update -t -2 -c "body was: $body"
            Send-Update -t 2 -c "Failed to create organization with error: $errorResponse"
            exit
        }   
    }
}
function Add-ProjectAdmin {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string]
        $projectName,
        [Parameter(Mandatory = $true)]
        [string]
        $user
    )
    $uri = "https://app.harness.io/authz/api/roleassignments?accountIdentifier=$($config.HarnessAccountId)&orgIdentifier=$($config.HarnessOrg)&projectIdentifier=$projectName"
    $body = @{
        "project" = @{
            "resourceGroupIdentifier" = "_all_project_level_resources"
            "roleIdentifier"          = "_project_admin"
            "principal"               = @{
                "scopeLevel" = "project"
                "identifier" = $user
                "type"       = "user"
            }
        }
    } | Convertto-Json
    try {
        Invoke-RestMethod -Method 'POST' -ContentType "application/json" -uri $uri -Headers $HarnessHeaders -body $body
    }
    catch {
        $errorResponse = $_ | Convertfrom-Json
        Send-Update -t 2 -c "Faied to add admin $user to project $projectName with error: $errorResponse"
        exit
    }
}
function Add-SecretJson {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string]
        $fileName, #name of json file
        [Parameter(Mandatory = $true)]
        [string]
        $id #ID of secret in Harness
    )
    $name = $id.replace("_"," ")
    # Add Json Secret File
    $uri = "https://app.harness.io/ng/api/v2/secrets/files?accountIdentifier=$($config.HarnessAccountId)&orgIdentifier=$($config.HarnessOrg)"
    $spec = @{
        secret = @{
            type          = 'SecretFile'
            name          = $name
            identifier    = $id
            orgIdentifier = $($config.HarnessOrg)
            spec          = @{
                secretManagerIdentifier = "org.harnessSecretManager"
            }
        }
    } | ConvertTo-Json
    $HarnessHeaders = @{
        'x-api-key'    = $config.HarnessPAT
        'Content-Type' = 'application/json'
    }
    $multipartContent = [System.Net.Http.MultipartFormDataContent]::new()
    $stringHeader = [System.Net.Http.Headers.ContentDispositionHeaderValue]::new("form-data")
    $stringHeader.Name = "spec"
    $StringContent = [System.Net.Http.StringContent]::new($spec)
    $StringContent.Headers.ContentDisposition = $stringHeader
    $multipartContent.Add($stringContent)
    $multipartFile = $fileName
    $FileStream = [System.IO.FileStream]::new($multipartFile, [System.IO.FileMode]::Open)
    $fileHeader = [System.Net.Http.Headers.ContentDispositionHeaderValue]::new("form-data")
    $fileHeader.Name = "file"
    $fileHeader.FileName = $fileName
    $fileContent = [System.Net.Http.StreamContent]::new($FileStream)
    $fileContent.Headers.ContentDisposition = $fileHeader
    $fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse("text/plain")
    $multipartContent.Add($fileContent)
    
    Try {
        Send-Update -t 1 -c "Adding/Updating secret json: $name"
        Invoke-WebRequest -Uri $uri -Body $multipartContent -Method 'POST' -headers $HarnessHeaders | Out-Null
    }
    Catch {
        # Generates a System.Management.Automation.ErrorRecord
        if ($_.Exception.Response.StatusCode.value__ -ne 401) {
            $errorResponse = $_ | Convertfrom-Json
            if ($errorResponse.message.contains("already exists")) {
                Send-Update -t 0 -c "Secret Json: $id already exists."
            }
            else {
                Send-Update -t 2 -c "Failed to create secret: $id with error: $errorResponse.message"
                Send-Update -t 0 -c "URI: $uri"
                Send-Update -t 0 -c "ContentType: $multipartContent"
                Send-Update -t 0 -c "Headers: $($HarnessHeaders| Select-Object -Property *)"
                Send-Update -t 0 -c "template yaml:"
                Send-Update -t 0 -c $body
            }  
        }
        else {
            Send-Update -t 2 -c "Failed to create secret: $id with error: $errorResponse.message"
            Send-Update -t 0 -c "URI: $uri"
            Send-Update -t 0 -c "ContentType: $multipartContent"
            Send-Update -t 0 -c "Headers: $($HarnessHeaders| Select-Object -Property *)"
            Send-Update -t 0 -c "template yaml:"
            Send-Update -t 0 -c $body
        }
    }
}
function Add-Variables {
    # Define the variables here that we want to use
    $variables = @(
        @{"name" = "google_project_id"; "value" = $config.GoogleProjectId },
        @{"name" = "google_region";"value" = $config.GoogleRegion },
        @{"name" = "google_resource_id";"value" = $config.GoogleResourceID }
    )
    # Install all variables at the org level.
    foreach ($variable in $variables) {
        if ($variable.value) {
            $uri = "https://app.harness.io/ng/api/variables?accountIdentifier=$($config.HarnessAccountId)"
            $body = @{
                variable = @{
                    name          = $variable.name.replace("_"," ")
                    identifier    = $variable.name
                    orgIdentifier = $($config.HarnessOrg)
                    description   = ""
                    type          = "String"
                    spec          = @{
                        valueType     = "FIXED"
                        fixedValue    = $variable.value ?? "thisshouldnothappen"
                        allowedValues = @()
                        defaultValue  = ""
                    }
                }
            } | ConvertTo-Json -Depth 5
            Send-Update -t 1 -c "Adding/Updating variable $($variable.name)"
            Try {
                Invoke-RestMethod -uri $uri -body $body -Method 'POST' -headers $HarnessHeaders | Out-null
            }
            Catch {
                # Generates a System.Management.Automation.ErrorRecord
                if ($_.Exception.Response.StatusCode.value__ -ne 401) {
                    $errorResponse = $_ | Convertfrom-Json
                    if ($errorResponse.message.contains("already exists")) {
                        Send-Update -t 0 -c "Template: $templateId already exists."
                    }
                    else {
                        Send-Update -t 2 -c "Failed to create variable: $($variable.name)"
                        Send-Update -t 0 -c "URI: $uri"
                        Send-Update -t 0 -c "ContentType: $contentType"
                        Send-Update -t 0 -c "Headers: $($templateheaders | Select-Object -Property *)"
                        Send-Update -t 0 -c "body:"
                        Send-Update -t 0 -c $body
                    }  
                }
                else {
                    Send-Update -t 2 -c "Failed to create template: $templateId. 401: $_)"
                    Send-Update -t 0 -c "URI: $uri"
                    Send-Update -t 0 -c "ContentType: $contentType"
                    Send-Update -t 0 -c "Headers: $($templateheaders | Select-Object -Property *)"
                    Send-Update -t 0 -c "template yaml:"
                    Send-Update -t 0 -c $body
                }
            }
        }
    }

}
function Enable-GoogleAuth {
    $uri1 = "https://app.harness.io/ng/api/authentication-settings/oauth/update-providers?accountIdentifier=$($config.HarnessAccountId)"
    $body = @{
        "allowedProviders" = @(
            "GOOGLE"
        )
        "settingsType"     = "OAUTH"
    } | Convertto-Json
    Invoke-RestMethod -method 'PUT' -ContentType "application/json" -Uri $uri1 -Headers $HarnessHeaders -Body $body | out-null
    $uri2 = "https://app.harness.io/ng/api/authentication-settings/update-auth-mechanism?accountIdentifier=$($config.HarnessAccountId)&authenticationMechanism=OAUTH"
    Invoke-RestMethod -method 'PUT' -Uri $uri2 -Headers $HarnessHeaders | out-null
}
function Get-DelegateConfig {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string]
        $delegateName
    )
    $uri = "https://app.harness.io/ng/api/download-delegates/kubernetes?accountIdentifier=$($config.HarnessAccountId)&orgIdentifier=$($config.HarnessOrg)"
    $body = @{
        "name" = $delegateName
        "tags" = @(
            $delegateName.substring(0,3)
        )
    } | ConvertTo-Json
    do {
        try {
            $response = Invoke-RestMethod -Method 'POST' -ContentType 'application/json' -uri $uri -Headers $HarnessHeaders -body $body
        }
        catch {
            $errorResponse = $_ | Convertfrom-Json
            if ($errorResponse.message.contains("Delegate with same name exists.")) {
                Send-Update -t 1 -c "$delegateName exists but is not connected. Attempting a blind delete due to yet another Harness API defect."
                $deleteUri = "https://app.harness.io/ng/api/delegate-setup/delegate/$("_$delegateName")?accountIdentifier=$($config.HarnessAccountId)&orgIdentifier=$($config.HarnessOrg)"
                #this worked once: 'https://app.harness.io/ng/api/delegate-setup/delegate/_gcp_delegate_event_nationwide?accountIdentifier=4jTfP5f9QNWImqbtdGEG1g&orgIdentifier=event_nationwide&projectIdentifier=string'
                Invoke-RestMethod -Method 'DEL' -uri $deleteUri -Headers $HarnessHeaders -body $body
            }
            else {
                Send-Update -t -2 -c "uri attempted was: $uri"
                Send-Update -t -2 -c "body was: $body"
                Send-Update -t 2 -c "Failed to create organization with error: $errorResponse"
                exit
            }
        }
    } until ($response)
    $response | Out-File -FilePath "$delegateName.yaml" -Force
    Send-Update -t 1 -c "Downloaded $delegateName to $delegateName.yaml"
}
function Get-DelegateStatus {
    [CmdletBinding()]
    $uri = "https://app.harness.io/ng/api/delegate-setup/listDelegates?accountIdentifier=$($config.HarnessAccountId)&orgIdentifier=$($config.HarnessOrg)&all=true"
    $body = @{
        "status"     = "CONNECTED"
        "filterType" = "Delegate"
    } | Convertto-Json
    $response = Invoke-RestMethod -method 'POST' -uri $uri -headers $HarnessHeaders -body $body -ContentType 'application/json'
    if ($response.resource) {
        return $response.resource
    }
    return $false
}
function Get-FeatureFlagStatus {
    $uri = "https://harness0.harness.io/cf/admin/features?accountIdentifier=l7B_kbSEQD2wjrM7PShm5w&projectIdentifier=FFOperations&orgIdentifier=PROD&environmentIdentifier=$($config.HarnessEnv)&targetIdentifierFilter=$($config.HarnessAccountId)&pageSize=10000"
    $response = Invoke-RestMethod -Uri $uri -method 'GET' -Headers $HarnessFFHeaders
    # parse this ridiculous API output for the values relevant to this account
    $currentFlags = [pscustomobject]@{}
    foreach ($item in $response.features) {
        $value = $item.envProperties.variationMap | Where-Object { $_.targets.identifier -eq $($config.HarnessAccountId) } | select-object -expandproperty variation
        $currentFlags | Add-Member -MemberType NoteProperty -name $item.identifier -value $value -Force
    }
    return $currentFlags
}
function Get-HarnessAdminCredentials {
    $harnessPortalToken = Send-Update -t 1 -c "Retrieving Harness Portal Token" -r "gcloud secrets versions access latest --secret='HarnessEventsAdmin' --project=$($config.AdminProjectId)"
    $script:harnessAdminHeaders = @{
        "authorization" = "Bearer $harnessPortalToken"
    }
}
function Get-HarnessUser {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string]
        $email
    )
    $uri = "https://app.harness.io/ng/api/user/batch?accountIdentifier=$($config.HarnessAccountId)"
    $response = invoke-restmethod -uri $uri -headers $HarnessHeaders -ContentType "application/json" -Method 'POST'
    
    $userExists = $response.data.content | Where-Object { $_.email.Contains($email) }
    if ($userExists) { return $userExists } else { return $false }
}
function Remove-Delegate {
    [CmdletBinding()]
    param (
        [Parameter()]
        [String]
        $delegateId
    )
    if ($whatif) {
        Send-Update -t 1 -c "whatif prevented: Removing hardness delegate: $($delegateId)"
        return
    }
    $uri = "https://app.harness.io/ng/api/delegate-setup/delegate/$($delegateId)?accountIdentifier=$($config.HarnessAccountId)&orgIdentifier=$($config.HarnessOrg)"
    Invoke-RestMethod -method 'DEL' -uri $uri -headers $HarnessHeaders -ContentType 'application/json' | Out-null
}
function Remove-HarnessEventDetails {
    [CmdletBinding()]
    param (
        [Parameter()]
        [object]
        $accounts #account, org, id, pat, env
    )
    $emailList = "none"
    foreach ($account in $accounts) {
        # Remove event users from Harness Account
        $HarnessHeaders = @{
            'x-api-key'    = $account.pat
            'Content-Type' = 'application/json'
        }
        $body = @{
            "searchTerm" = "harnessevents.io"
        } | ConvertTo-Json
        $userdetailsuri = "https://app.harness.io/ng/api/user/batch?accountIdentifier=$($account.id)&orgIdentifier=$($account.org)"
        $response = invoke-restmethod -uri $userdetailsuri -headers $HarnessHeaders -ContentType "application/json" -Method 'POST' -body $body
        $harnessUsers = $response.data.content | Where-Object { $_.email.Contains("@harnessevents.io") }
        foreach ($user in $harnessUsers) {
            $killuseruri = "https://app.harness.io/ng/api/user/$($user.uuid)?accountIdentifier=$($account.id)"
            if ($whatif) {
                Send-Update -t 1 -c "whatif prevented: Removed $($user.email) from account $($account.id)"
                break
            }
            invoke-restmethod -uri $killuseruri -headers $HarnessHeaders -ContentType "application/json" -Method 'DEL' | Out-Null
            Send-Update -t 1 -c "Removed $($user.email) from account $($account.id)"
        }
        if ($account.account -eq "HarnessEvents") {
            if ($whatif) {
                Send-Update -1 -c "whatif prevented: Removing Harness org: $($account.org)"
            }
            else {
                # Do specific things for HarnessEvents
                Send-Update -t 1 -c "Skipping flag 'after event' state since this is the common account"
                Send-Update -t 1 -c "Removing Harness org: $($account.org)"
                $uri = "https://app.harness.io/ng/api/organizations/$($account.org)?accountIdentifier=$($account.id)"
                Invoke-RestMethod -Method 'DEL' -headers $HarnessHeaders -uri $uri | Out-Null
            }
        }
        else {
            Send-Update -t 2 -c "NEED TO REDO LOGIC HERE for V2 version of customer account org cleanup!"
            $featureFlagsStart = Get-Content -path ./harnesseventsdata/config/featureflagsend.json | Convertfrom-Json
            $currentFlags = Get-FeatureFlagStatus
            $flagsNeeded = Compare-Object @($featureFlagsStart.PSObject.Properties) @($currentFlags.PSObject.Properties) -Property Name, Value | Where-Object { $_.SideIndicator -eq "<=" }
            foreach ($flag in $flagsNeeded) {
                Update-FeatureFlag -flag $flag.Name -value $flag.Value
            }
            do {
                $currentFlags = Get-FeatureFlagStatus
                $flagsNeeded = Compare-Object @($featureFlagsStart.PSObject.Properties) @($currentFlags.PSObject.Properties) -Property Name, Value | Where-Object { $_.SideIndicator -eq "<=" }
                Send-Update -t 1 -c "Waiting for $($flagsNeeded.count) flag(s)..."
                Start-Sleep -s 2
            } until (-not $flagsNeeded)
        }
        if ($emailList -eq "none") { $emailList = "" }
        if ($emailList) {
            $emailList += ","
        }
        $emailList += $account.org + ";" + $account.creator
    }
    $Env:EmailList = $emailList
}
function Remove-HarnessUsers {
    # Remove any orphaned users from HarnessEvents keeping it tidy
    $googleUsers = Get-Allusers
    $HarnessHeaders = @{
        'x-api-key'    = $config.HarnessEventsPAT
        'Content-Type' = 'application/json'
    }
    $body = @{
        "searchTerm" = "harnessevents.io"
    } | ConvertTo-Json
    $accountID = $config.HarnessEventsPAT.split(".")[1]
    $userdetailsuri = "https://app.harness.io/ng/api/user/batch?accountIdentifier=$accountID"
    $response = invoke-restmethod -uri $userdetailsuri -headers $HarnessHeaders -ContentType "application/json" -Method 'POST' -body $body
    $harnessUsers = $response.data.content | Where-Object { $_.email.Contains("@harnessevents.io") }
    foreach ($user in $harnessUsers) {
        if ($googleUsers.primaryEmail -notcontains $user.email) {
            Send-Update -t 1 -c "Removing extraneous user: $($user.email)"
            $killuseruri = "https://app.harness.io/ng/api/user/$($user.uuid)?accountIdentifier=$accountID"
            invoke-restmethod -uri $killuseruri -headers $HarnessHeaders -ContentType "application/json" -Method 'DEL' | Out-Null
        }
        else {
            Send-Update -t 1 -c "$($user.email) is valid."
        }
    }
}
function Test-Connectivity {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string]
        $harnessToken
    )
    Send-Update -t 1 -c "Starting Harness connectivity check"
    $harnessSplit = $harnessToken.split(".")
    if ($harnessSplit.count -ne 4) {
        Send-Update -t 3 -c "Harness Platform token was malformed."
    }
    $harnessAccount = $harnessSplit[1]
    $TestHarnessHeaders = @{
        "x-api-key" = $harnessToken
    }
    Send-Update -t 1 -c "Harness token..." -append
    $uri = "https://app.harness.io/ng/api/accounts/$harnessAccount"
    try {
        $response = Invoke-RestMethod -Method 'GET' -ContentType "application/json" -uri $uri -Headers $TestHarnessHeaders
    }
    catch {
        Send-Update -t 3 -c "Failed to connect to Harness API: $($_.Exception.Message)"
    }
    Send-Update -t 1 -c "is valid."
    Set-Prefs -k "HarnessAccount" -v $response.data.companyName
    Set-Prefs -k "HarnessAccountId" -v $harnessAccount
    Set-Prefs -k "HarnessPAT" -v $harnessToken
    # OMG Why do 2 Harness API's use DIFFERENT strings to describe the SAME ENVIRONMENT *internal sobbing*
    $fixGodDamnEnv = $response.data.cluster.replace("-","")
    $correctEnv = $fixGodDamnEnv.substring(0,1).toUpper() + $fixGodDamnEnv.substring(1)
    if ($correctEnv -ne "Prod1") {
        Send-Update -t 2 "$correctEnv isn't the expected environment of Prod1 - just FYI if something doesn't work right."
    }
    Set-Prefs -k "HarnessEnv" -v $correctEnv
    return $response
}
function Update-FeatureFlag {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string]
        $flag,
        [Parameter(Mandatory = $true)]
        [string]
        $value
    )
    $body = @{
        "instructions" = @(
            @{
                "kind"       = "addTargetToFlagsVariationTargetMap"
                "parameters" = @{
                    "features" = @(
                        @{
                            "identifier" = $flag
                            "variation"  = $value
                        }
                    )
                }
            }
        )
    } | ConvertTo-Json -Depth 10
    Send-Update -t 1 -c "Updating feature flag $flag with value '$value'"
    $uri = "https://harness0.harness.io/cf/admin/targets/$($config.HarnessAccountId)?accountIdentifier=l7B_kbSEQD2wjrM7PShm5w&orgIdentifier=PROD&projectIdentifier=FFOperations&environmentIdentifier=$($config.HarnessEnv)"
    Try {
        Invoke-RestMethod -Method 'Patch' -ContentType "application/json" -uri $uri -Headers $HarnessFFHeaders -body $body | Out-Null
    }
    catch {
        $errorResponse = $_ | Convertfrom-Json
        if ($errorResponse.message.contains("Failed to find feature activation")) {
            Send-Update -t 2 -c "Continuing- but $flag is not found. Confirm the flag was deleted and then ensure it's removed from both /harnesseventsdata/config/featureflags*.json files."
            return $false
        }
        Send-Update -t 0 -c "Feature flag failed with uri: $uri"
        Send-Update -t 0 -c "And body of $body"
        Send-Update -t 3 -c "There was a critical failure with this feature flag. The API error was $errorResponse."
    }
    Send-Update -t 1 -c "feature flag $flag variation set: $value"
    return $true
}

## Classroom functions
function Get-GCPProjectList {
    # Retrieve administration organization

    #Set-Prefs -k "AdminOrgId" -v $adminOrgId
    # Retrieve all child projects except administration
    $AdminProjectInfo = Send-Update -t 1 -c "Retrieving billing account" -r "gcloud billing accounts list --filter=displayName='HarnessEvents' --format=json" | ConvertFrom-Json
    $billingaccount = $AdminProjectInfo.name.split("/")[1]
    $projects = Send-Update -t 1 -c "Retrieving projects" -r "gcloud billing projects list --billing-account=$billingaccount --filter='-name:administration' --format=json" | Convertfrom-Json
    foreach ($project in $projects) {
        # get the project name because the billing account view doesn't pull that. fun.
        $projectDetails = Send-Update -t 1 -c "Getting details of project: $($project.projectId)" -r "gcloud projects describe $($project.projectId) --format=json" | Convertfrom-Json
        $project | Add-Member -MemberType NoteProperty -Name "eventName" -Value $projectDetails.name
        $project | Add-Member -MemberType NoteProperty -Name "projectNumber" -Value $projectDetails.projectNumber
    }
    return $projects
}
function New-GCPProject {
    ## Create Project
    $projectCheck = Send-Update -t 1 -c "Check for existing project" -r "gcloud projects list --filter=name:$($config.GoogleClassroom) --format=json" | convertfrom-json
    if ($projectCheck) {
        # Project already exists- skip creation
        Send-Update -t 1 -c "Project already exists- skipping creation."
        Set-Prefs -k "GoogleProjectId" -v $projectCheck.projectId
    }
    else {
        # Get organization of admin project to assign to new project
        $googleAdminAncestors = Send-Update -t 1 -c "Retrieve org info" -r "gcloud projects get-ancestors $($config.AdminProjectId) --format=json" | ConvertFrom-Json
        $GoogleOrgId = ($googleAdminAncestors | Where-Object { $_.type -eq "organization" }).id
        # Get billing project of admin project to associate with this project
        $projectID = "event-$(Get-Randomstring)"
        $projectID = $projectID.tolower()
        Send-Update -t 1 -o -c "Create $($config.GoogleClassroom) project" -r "gcloud projects create $projectID --name=$($config.GoogleClassroom) --organization=$GoogleOrgId --set-as-default -q"
        while (-not $projectDetails) {
            $projectDetails = Send-Update -t 1 -c "Waiting for project to be available..." -r "gcloud projects list --filter=name:$($config.GoogleClassroom) --format=json" | Convertfrom-Json   
            Start-Sleep -s 6
        }
        Set-Prefs -k "GoogleProjectId" -v $projectDetails.projectId
    }
    ## Account Billing
    $AdminProjectInfo = Send-Update -t 1 -c "Retrieving billing account" -r "gcloud billing accounts list --filter=displayName='HarnessEvents' --format=json" | ConvertFrom-Json
    $GoogleBillingProject = $AdminProjectInfo.name.split("/")[1]
    $billingCheck = Send-Update -t 1 -c "Checking if billing account is associated to this project already." -r "gcloud billing projects describe $($config.GoogleProjectId) --format=json" | Convertfrom-Json
    if ($billingCheck.billingAccountName -and $billingCheck.billingAccountName.substring(0,16) -eq "billingAccounts/") { $billingAccount = $billingCheck.billingAccountName.substring(16) }
    if ($billingAccount -eq $GoogleBillingProject) {
        Send-Update -t 1 -c "Project already is associated to billing account: $GoogleBillingProject"
    }
    else {
        Send-Update -t 1 -o -append -c "Connecting billing account" -r "gcloud billing projects link $($config.GoogleProjectId) --billing-account=$GoogleBillingProject"
        $counter = 0
        while ($billingAccount -ne $GoogleBillingProject) {
            Start-Sleep -s 4
            $billingCheck = gcloud billing projects describe $($config.GoogleProjectId) --format=json | Convertfrom-Json
            if ($billingCheck.billingAccountName -and $billingCheck.billingAccountName.substring(0,16) -eq "billingAccounts/") { $billingAccount = $billingCheck.billingAccountName.substring(16) }
            Send-Update -t 1 -append "."
            $counter++
            if ($counter -ge 20) {
                Send-Update -t 3 -c "The Google billing account never associated with the project."
            }
        }
        Send-Update -t 1 -c "connected"
    }
    ## IAM Bindings
    $currentIAM = gcloud projects get-iam-policy $config.GoogleProjectId --format=json | Convertfrom-Json
    if ($currentIAM.bindings.members -notcontains "group:300@harnessevents.io") { 
        Send-Update -t 1 -o -c "Adding group 300@harnessevents.io to project" -r "gcloud projects add-iam-policy-binding $($config.GoogleProjectId) --member='group:300@harnessevents.io' --role='roles/owner' -q" | out-null
    }
    if ($currentIAM.bindings.members -notcontains "user:$($config.InstructorEmail)") { 
        Send-Update -t 1 -o -c "Adding user $($config.InstructorEmail) to project" -r "gcloud projects add-iam-policy-binding $($config.GoogleProjectId) --member='user:$($config.InstructorEmail)' --role='roles/owner' -q" | out-null
    }
    if ($currentIAM.bindings.members -notcontains "group:$($config.GoogleEventEmail)") { 
        Send-Update -t 1 -o -c "Adding group $($config.GoogleEventEmail) to project" -r "gcloud projects add-iam-policy-binding $($config.GoogleProjectId) --member='group:$($config.GoogleEventEmail)' --role='roles/editor' -q" | out-null
    }
    # Enable API's needed for events
    $currentAPIS = Send-Update -t 1 -c "Retrieving currently enabled API's" -r "gcloud services list --enabled --format=json --project=$($config.GoogleProjectId) | Convertfrom-Json | Select-Object -Expandproperty config | Select-Object -Expandproperty name"
    $projectAPIs = @("compute.googleapis.com","container.googleapis.com","run.googleapis.com")
    Foreach ($api in $projectApis) {
        if ($currentAPIS -notcontains $api) {
            send-Update -t 1 -o -c "Enabling api: $api" -r "gcloud services enable $api --project=$($config.GoogleProjectId)"
        }
        else {
            Send-Update -t 1 -c "$api already enabled."
        }
    }
    # Wait for confirmation that API's are enabled
    $counter = 0
    Do {
        $counter++
        if ($counter -ge 10) {
            Send-Update -t 3 -c "It took too long enabling needed API's.  I blame Google."
        }
        $enabledAPIs = gcloud services list --project=$($config.GoogleProjectId) --format=json | Convertfrom-Json
        $neededAPIs = Compare-Object $projectAPIs $enabledAPIs.config.name | Where-Object { $_.SideIndicator -eq "<=" }
        Start-Sleep -s 2
    } until (-not $neededAPis)
    # Create worker, get keys, add to IAM
    $serviceAccountCheck = gcloud iam service-accounts list --filter='email ~ worker1' --format=json --project=$($config.GoogleProjectId) --verbosity=error | Convertfrom-Json
    if (-not $serviceAccountCheck) {
        Send-Update -t 1 -o -c "Creating service account" -r "gcloud iam service-accounts create worker1 --project=$($config.GoogleProjectId)" -append
        Do {
            Send-Update -t 1 -c "." -append
            $serviceAccount = gcloud iam service-accounts list --filter='email ~ worker1' --format=json --project=$($config.GoogleProjectId) --verbosity=error | Convertfrom-Json
            if (-not $serviceAccount) { Start-Sleep -s 2 }
        } until ($serviceAccount)
        Send-Update -t 1 -c "created"
        Send-Update -t 1 -o -c "Grant service account permissions" -r "gcloud projects add-iam-policy-binding $($config.GoogleProjectId) --member=serviceAccount:worker1@$($config.GoogleProjectId).iam.gserviceaccount.com --role='roles/editor'"
        Send-Update -t 1 -o -c "Generate local key json file" -r "gcloud iam service-accounts keys create worker1.json --iam-account=worker1@$($config.GoogleProjectId).iam.gserviceaccount.com"
        Add-SecretJson -fileName worker1.json -id GCP_Service_Account
    }
    else {
        Send-Update -t 1 -c "Service account already created. Skipping"
    }
    if (Test-Path worker1.json) { Remove-Item worker1.json }
    # Load GCP-specific templates
    Add-OrgYaml -YamlFolder ./harnesseventsdata/orgGCP
    # Move on to loading GCP resources unless skipping
    if ($skipInfra) { return }
    New-GCPResources
}
function New-GCPResources {
    # Create unique Google Resource ID (this will be harnessevents normally, but creates a unique ID if shared environment)
    if ($googleCloudProjectOverride) {
        # We're building this cluster in a potentially shared space- use the current user as an indentifier
        $cleanIdentifier = "-$($config.GoogleUser.split('@')[0].replace('.',''))"
        $clusterRegion = "us-central1"
    }
    else {
        $clusterRegion = Send-Update -t 1 -c "Getting first available region" -r "gcloud compute regions list --filter='name:us-*' --limit=1 --format='value(NAME)' --verbosity=error --project=$($config.GoogleProjectId)"
    }
    # Save the identifier/region used here for fun activities later
    Set-Prefs -k "GoogleResourceID" -v "harnessevent$cleanIdentifier"
    Set-Prefs -k "GoogleRegion" -v "$clusterRegion"
    # Create cluster if needed
    $clusterExists = Send-Update -t 1 -c "Check for Google harnessevent cluster" -r "gcloud container clusters list --filter=name=$($config.GoogleResourceID) --format=json  --verbosity=error --project=$($config.GoogleProjectId)" | Convertfrom-Json
    if (-not $clusterExists) {
        Send-Update -t 1 -c "Create kubernetes cluster" -r "gcloud container clusters create $($config.GoogleResourceID) -m e2-standard-4 --num-nodes=1 --zone=$clusterRegion --no-enable-insecure-kubelet-readonly-port --scopes=cloud-platform  --project=$($config.GoogleProjectid)"
        $clusterExists = Send-Update -t 1 -c "Confirm cluster exists" -r "gcloud container clusters list --filter=name=$($config.GoogleResourceID) --format=json --project=$($config.GoogleProjectId)" | Convertfrom-Json
        if (-not $clusterExists) {
            Send-Update -t 2 -c "Attempted to create google kubernetes cluster it failed.  IT FAILED SO BAD. WHY?  WHYYYYYY GOOGLE?"
            exit
        }
    }
    Send-Update -t 1 -o -c "Retrieve kubernetes credentials" -r "gcloud container clusters get-credentials $($config.GoogleResourceID) --zone=$clusterRegion  --project=$($config.GoogleProjectId)"  
    Add-Delegate -delegatePrefix "gcp"
    # Create google artifact registry if needed
    $registryExists = Send-Update -t 1 -c "Check if Artifact Registry exists" -r "gcloud artifacts repositories list --filter=$($config.GoogleResourceID) --project=$($config.GoogleProjectId) --format=json" | Convertfrom-Json
    if ($registryExists) {
        Send-Update -t 0 -c "Registry exists- skipping create"
    }
    else {
        # Create Google artifact registry
        Send-Update -t 1 -c "Create google artifact registry" -r "gcloud artifacts repositories create $($config.GoogleResourceID) --repository-format=docker --location=$($config.GoogleRegion) --project=$($config.GoogleProjectId)"
    }
}
function Remove-GCPProject {
    [CmdletBinding()]
    param (
        [Parameter(Mandatory = $true)]
        [string]
        $id
    )
    if ($whatif) {
        Send-Update -t 1 -c "whatif prevented: Removing Google Project $id"
        return
    }
    Send-Update -t 1 -o -c "Removing Google Project $id" -r "gcloud projects delete $id --quiet"
    $Counter = 0
    Do {
        $counter++
        if ($counter -ge 10) {
            Send-Update -t 2 -c "Wow, something went terrrrrrribly wrong trying to remove Google Project: $id"
            exit
        }
        $projectCheck = Send-Update -t 1 -c "Waiting for project delete confirmation..." -r "gcloud projects list --filter='name:$id' --format=json" | convertfrom-json
        Start-Sleep -s 5
    } while ($projectCheck)
}

## Main
Test-PreFlight
Get-Prefs($Myinvocation.MyCommand.Source)
switch ($action) {
    "create" { Invoke-Create }
    "remove" { Invoke-Janitor }
    "reload" { Invoke-Create }
    Default { Get-Help }
}
