# -*- coding: utf8 -*-

import json, os
import requests
from qcloud_cos_v5 import CosConfig
from qcloud_cos_v5 import CosS3Client
from tencentcloud.common import credential
from tencentcloud.scf.v20180416 import scf_client, models


def setFunctionConfigure(name, namespace, region, secreetId, secretKey, token):
    try:
        environmentVariablesList = [{
            "Key": "real_time_log",
            "Value": "close"
        }]
        cred = credential.Credential(secreetId, secretKey, token=token)
        client = scf_client.ScfClient(cred, region)

        req = models.GetFunctionRequest()
        params = json.dumps({"FunctionName": name, "Namespace": namespace, "ShowCode": "FALSE"})
        req.from_json_string(params)

        resp = client.GetFunction(req)
        environmentVariables = json.loads(resp.to_json_string())["Environment"]["Variables"]

        for eveVariables in environmentVariables:
            if eveVariables["Key"] == "real_time_log_id" or eveVariables["Key"] == "real_time_log_url" or eveVariables["Key"] == "real_time_log":
                continue
            environmentVariablesList.append(eveVariables)

        print(environmentVariablesList)
        req = models.UpdateFunctionConfigurationRequest()
        params = json.dumps({"FunctionName": name,
                             "Environment": {
                                 "Variables": environmentVariablesList
                             },
                             "Namespace": namespace})
        req.from_json_string(params)

        resp = client.UpdateFunctionConfiguration(req)
        print(resp.to_json_string())
        return True
    except Exception as e:
        print(e)
        return False


def main_handler(event, context):
    print("event is: ", event)

    connectionID = event['websocket']['secConnectionID']

    region = os.environ.get("bucket_region")
    secreetId = os.environ.get("TENCENTCLOUD_SECRETID")
    secretKey = os.environ.get("TENCENTCLOUD_SECRETKEY")
    token = os.environ.get("TENCENTCLOUD_SESSIONTOKEN")
    config = CosConfig(Region=region, SecretId=secreetId, SecretKey=secretKey, Token=token)
    client = CosS3Client(config)
    response = client.get_object(
        Bucket=os.environ.get("bucket"),
        Key=connectionID,
    )
    response['Body'].get_stream_to_file('/tmp/connid.json')
    with open('/tmp/connid.json') as f:
        data = json.loads(f.read())

    if not setFunctionConfigure(
            data["function"],
            data["namespace"],
            data["region"],
            secreetId,
            secretKey,
            token,
    ):
        return False

    retmsg = {}
    retmsg['websocket'] = {}
    retmsg['websocket']['action'] = "closing"
    retmsg['websocket']['secConnectionID'] = connectionID
    requests.post(os.environ.get("url"), json=retmsg)
    return retmsg
