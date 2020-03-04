# -*- coding: utf8 -*-

import json, os
from qcloud_cos_v5 import CosConfig
from qcloud_cos_v5 import CosS3Client
from tencentcloud.common import credential
from tencentcloud.scf.v20180416 import scf_client, models


def setFunction2Bucket(name, namespace, secretId, secretKey, token, connid):
    region = os.environ.get("bucket_region")
    config = CosConfig(Region=region, SecretId=secretId, SecretKey=secretKey, Token=token)
    client = CosS3Client(config)
    response = client.put_object(
        Bucket=os.environ.get("bucket"),
        Body=json.dumps({
            "region": region,
            "namespace": namespace,
            "function": name
        }).encode("utf-8"),
        Key=connid,
        EnableMD5=False
    )
    return response


def setFunctionConfigure(name, namespace, region, secreetId, secretKey, token, connid, transurl):
    try:
        environmentVariablesList = [
            {
                "Key": "real_time_log_id",
                "Value": connid
            },
            {
                "Key": "real_time_log_url",
                "Value": transurl
            },
            {
                "Key": "real_time_log",
                "Value": "open"
            }
        ]
        cred = credential.Credential(secreetId, secretKey, token=token)
        client = scf_client.ScfClient(cred, region)

        req = models.GetFunctionRequest()
        req.from_json_string(json.dumps({"FunctionName": name, "Namespace": namespace, "ShowCode": "FALSE"}))
        resp = client.GetFunction(req)
        environmentVariables = json.loads(resp.to_json_string())["Environment"]["Variables"]
        for eveVariables in environmentVariables:
            if eveVariables["Key"] == "real_time_log_id" or eveVariables["Key"] == "real_time_log_url" or eveVariables["Key"] == "real_time_log":
                continue
            environmentVariablesList.append(eveVariables)

        req = models.UpdateFunctionConfigurationRequest()
        req.from_json_string(json.dumps({"FunctionName": name,
                                         "Environment": {
                                             "Variables": environmentVariablesList
                                         },
                                         "Namespace": namespace}))
        client.UpdateFunctionConfiguration(req)

        setFunction2Bucket(name, namespace, secreetId, secretKey, token, connid)
        return True
    except Exception as e:
        print(e)
        return False


def main_handler(event, context):
    print("event is: ", event)

    connectionID = event['websocket']['secConnectionID']
    if not setFunctionConfigure(
            event['queryString']['name'],
            event['queryString']['namespace'],
            event['queryString']['region'],
            os.environ.get("TENCENTCLOUD_SECRETID"),
            os.environ.get("TENCENTCLOUD_SECRETKEY"),
            os.environ.get("TENCENTCLOUD_SESSIONTOKEN"),
            connectionID,
            os.environ.get("url")
    ):
        return False

    if 'requestContext' not in event.keys():
        return {"errNo": 101, "errMsg": "not found request context"}
    if 'websocket' not in event.keys():
        return {"errNo": 102, "errMsg": "not found web socket"}

    retmsg = {}
    retmsg['errNo'] = 0
    retmsg['errMsg'] = "ok"
    retmsg['websocket'] = {
        "action": "connecting",
        "secConnectionID": connectionID
    }

    if "secWebSocketProtocol" in event['websocket'].keys():
        retmsg['websocket']['secWebSocketProtocol'] = event['websocket']['secWebSocketProtocol']
    if "secWebSocketExtensions" in event['websocket'].keys():
        ext = event['websocket']['secWebSocketExtensions']
        retext = []
        exts = ext.split(";")
        print(exts)
        for e in exts:
            e = e.strip(" ")
            if e == "permessage-deflate":
                pass
            if e == "client_max_window_bits":
                pass
        retmsg['websocket']['secWebSocketExtensions'] = ";".join(retext)

    print("connecting: connection id:%s" % event['websocket']['secConnectionID'])
    return retmsg
