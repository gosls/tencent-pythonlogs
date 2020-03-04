const path = require('path')
const util = require('util')
const { Component } = require('@serverless/core')
const tencentAuth = require('serverless-tencent-auth-tool')
const tencentcloud = require('tencentcloud-sdk-nodejs')
const { cam, common } = tencentcloud
const clientProfile = common.ClientProfile
const HttpProfile = common.HttpProfile
const camCredential = common.Credential
const camClient = cam.v20190116.Client
const camModels = cam.v20190116.Models

class PythonRealTimeLogs extends Component {
  sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms)
    })
  }

  getCamClient(credentials) {
    // create cam client
    const cred = credentials.token
      ? new camCredential(credentials.SecretId, credentials.SecretKey, credentials.token)
      : new camCredential(credentials.SecretId, credentials.SecretKey)
    const httpProfile = new HttpProfile()
    httpProfile.reqTimeout = 30
    return new camClient(cred, 'ap-guangzhou', new clientProfile('HmacSHA256', httpProfile))
  }

  async bindPythonLogRole(credentials) {
    const rp = 200
    let roleName = 'SCF_PythonLogsRole'
    let pageRoleCount = 200
    let hasRole = false
    const cam = this.getCamClient(credentials)
    const policyList = ['QcloudCOSFullAccess', 'QcloudSCFFullAccess']

    // 寻找roleList，防止出现区分大小问题
    // 在cam测，role实际上是区分大小写，例如SLS_QcsRole和SLS_QCSRole就是两个角色
    // 但是cam在拉取role判断权限的时候，是不区分大小写，所以同时出现两个role，可能会提醒没权限
    try {
      const listRoleModels = new camModels.DescribeRoleListRequest()
      const listRoleHandler = util.promisify(cam.DescribeRoleList.bind(cam))
      const body = { Rp: rp, Page: 0 }
      while (!hasRole && pageRoleCount == 200) {
        try {
          body.Page = body.Page + 1
          listRoleModels.from_json_string(JSON.stringify(body))
          const pageRoleList = await listRoleHandler(listRoleModels)
          pageRoleCount = pageRoleList.List.length
          for (let i = 0; i < pageRoleList.List.length; i++) {
            if (roleName.toUpperCase() == pageRoleList.List[i].RoleName.toUpperCase()) {
              roleName = pageRoleList.List[i].RoleName // 查到不区分大小写的role，则使用该role
              hasRole = true
              break
            }
          }
        } catch (e) {}
        await this.sleep(340) // 有频率限制 1分3次
      }
    } catch (e) {}

    // 如果有有同样的role，则用已有的role
    // 如果没有或者查询失败，则尝试新建role
    if (!hasRole) {
      try {
        const createRoleModels = new camModels.CreateRoleRequest()
        createRoleModels.from_json_string(
          JSON.stringify({
            RoleName: roleName,
            Description: 'Serverless Framework For Python RealTime Role',
            PolicyDocument: JSON.stringify({
              version: '2.0',
              statement: [
                {
                  effect: 'allow',
                  principal: {
                    service: 'scf.qcloud.com'
                  },
                  action: 'sts:AssumeRole'
                }
              ]
            })
          })
        )
        const createRoleHandler = util.promisify(cam.CreateRole.bind(cam))
        await createRoleHandler(createRoleModels)
      } catch (e) {}
    } else {
      // 如果有role，则需要查询已经存在的policy
      try {
        let pagePolicyCount = 200
        const body = { Rp: rp, Page: 0 }
        body.Page = 0
        const listAttachedRolePoliciesModels = new camModels.ListAttachedRolePoliciesRequest()
        const listAttachedRolePoliciesHandler = util.promisify(
          cam.ListAttachedRolePolicies.bind(cam)
        )
        body.RoleName = roleName
        while (pagePolicyCount == 200) {
          try {
            body.Page = body.Page + 1
            listAttachedRolePoliciesModels.from_json_string(JSON.stringify(body))
            const pagePolicyList = await listAttachedRolePoliciesHandler(
              listAttachedRolePoliciesModels
            )
            pagePolicyCount = pagePolicyList.List.length
            for (let i = 0; i < pagePolicyList.List.length; i++) {
              const temp = policyList.indexOf(pagePolicyList.List[i].PolicyName)
              if (temp != -1) {
                policyList[temp] = undefined // 如果已存在policy，则不再进行绑定，在待绑定列表移除
              }
            }
            await this.sleep(340) // 有频率限制 1分3次
          } catch (e) {}
        }
      } catch (e) {}
    }

    // 查询并绑定， 如果这一步出错，就可以直接抛错了
    const listPoliciesModels = new camModels.ListPoliciesRequest()
    const listPoliciesHandler = util.promisify(cam.ListPolicies.bind(cam))

    let pagePolicyCount = 200
    const policyDict = {}
    const body = { Rp: rp, Page: 0 }
    while (pagePolicyCount == 200) {
      try {
        body.Page = body.Page + 1
        listPoliciesModels.from_json_string(JSON.stringify(body))
        const pagePolicList = await listPoliciesHandler(listPoliciesModels)
        for (let i = 0; i < pagePolicList.List.length; i++) {
          policyDict[pagePolicList.List[i].PolicyName] = pagePolicList.List[i].PolicyId
        }
        pagePolicyCount = pagePolicList.List.length
        await this.sleep(340) // 有频率限制 1分3次
      } catch (e) {}
    }
    const attachRolePolicyModels = new camModels.AttachRolePolicyRequest()
    const attachRolePolicyHandler = util.promisify(cam.AttachRolePolicy.bind(cam))
    const attachRolePolicyBody = {
      AttachRoleName: roleName
    }
    for (let i = 0; i < policyList.length; i++) {
      try {
        if (policyList[i]) {
          attachRolePolicyBody.PolicyId = policyDict[policyList[i]]
          attachRolePolicyModels.from_json_string(JSON.stringify(attachRolePolicyBody))
          await attachRolePolicyHandler(attachRolePolicyModels)
          await this.sleep(340)
        }
      } catch (e) {}
    }
  }

  async default(inputs = {}) {
    const auth = new tencentAuth()
    this.context.credentials.tencent = await auth.doAuth(this.context.credentials.tencent, {
      client: 'tencent-pythonlogs',
      remark: inputs.fromClientRemark,
      project: this.context.instance ? this.context.instance.id : undefined,
      action: 'default'
    })
    await this.bindPythonLogRole(this.context.credentials.tencent)

    const region = inputs.region || 'ap-guangzhou'
    const tencentCOS = await this.load('@serverless/tencent-cos', 'PythonRealTimeLogsCOS')
    const cosOutput = await tencentCOS({
      region: region,
      bucket: 'python-real-time-logs'
    })
    const tencentApiGateway = await this.load(
      '@serverless/tencent-apigateway',
      'PythonRealTimeLogsAPIGW'
    )
    const apigwOutput = await tencentApiGateway({
      region: region,
      protocols: ['http', 'https'],
      serviceName: 'PythonRealTimeLogsService',
      environment: 'test',
      endpoints: [
        {
          path: '/python_real_time_logs',
          method: 'GET',
          protocol: 'WEBSOCKET',
          serviceTimeout: 1799,
          function: {
            transportFunctionName: 'PythonRealTimeLogs_Transport',
            registerFunctionName: 'PythonRealTimeLogs_Register',
            cleanupFunctionName: 'PythonRealTimeLogs_Cleanup'
          }
        },
        {
          path: '/report',
          method: 'ANY',
          function: {
            functionName: 'PythonRealTimeLogs_Transport'
          }
        }
      ]
    })
    let internalDomain
    const reportDomain = `http://${apigwOutput.subDomain}/test/report`
    var websocketDomain = `ws://${apigwOutput.subDomain}/test/python_real_time_logs`
    for (let i = 0; i < apigwOutput.apis.length; i++) {
      if (apigwOutput.apis[i].path == '/python_real_time_logs') {
        internalDomain = apigwOutput.apis[i].internalDomain
      }
    }

    const logsFunctionir = path.join(__dirname, 'component')
    let functionName = 'PythonRealTimeLogs_Register'
    let logsFunction = await this.load('@serverless/tencent-scf', functionName)
    await logsFunction({
      name: functionName,
      role: 'SCF_PythonLogsRole',
      codeUri: logsFunctionir,
      handler: 'reg.main_handler',
      runtime: 'Python3.6',
      region: region,
      description: '实时日志组件注册函数',
      memorySize: '64',
      timeout: '10',
      environment: {
        variables: {
          url: reportDomain,
          bucket_region: region,
          bucket: cosOutput.bucket
        }
      }
    })
    functionName = 'PythonRealTimeLogs_Transport'
    logsFunction = await this.load('@serverless/tencent-scf', functionName)
    await logsFunction({
      name: functionName,
      role: 'SCF_PythonLogsRole',
      codeUri: logsFunctionir,
      handler: 'trans.main_handler',
      runtime: 'Python3.6',
      region: region,
      description: '实时日志组件回推函数',
      memorySize: '64',
      timeout: '10',
      environment: {
        variables: {
          url: internalDomain,
          bucket_region: region,
          bucket: cosOutput.bucket
        }
      }
    })
    functionName = 'PythonRealTimeLogs_Cleanup'
    logsFunction = await this.load('@serverless/tencent-scf', functionName)
    await logsFunction({
      name: functionName,
      role: 'SCF_PythonLogsRole',
      codeUri: logsFunctionir,
      handler: 'close.main_handler',
      runtime: 'Python3.6',
      region: region,
      description: '实时日志组件清理函数',
      memorySize: '64',
      timeout: '10',
      environment: {
        variables: {
          url: internalDomain,
          bucket_region: region,
          bucket: cosOutput.bucket
        }
      }
    })

    this.state = {
      cos: ['PythonRealTimeLogsCOS'],
      apigw: ['PythonRealTimeLogsAPIGW'],
      scf: [
        'PythonRealTimeLogs_Register',
        'PythonRealTimeLogs_Transport',
        'PythonRealTimeLogs_Cleanup'
      ]
    }
    await this.save()

    return {
      websocket: websocketDomain
    }
  }

  async remove() {
    for (let i = 0; i < this.state.cos.length; i++) {
      await (await this.load('@serverless/tencent-cos', this.state.cos[i])).remove()
    }
    for (let i = 0; i < this.state.scf.length; i++) {
      await (await this.load('@serverless/tencent-scf', this.state.scf[i])).remove()
    }
    for (let i = 0; i < this.state.apigw.length; i++) {
      await (await this.load('@serverless/tencent-apigateway', this.state.apigw[i])).remove()
    }
  }
}

module.exports = PythonRealTimeLogs
