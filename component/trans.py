# -*- coding: utf8 -*-
import os
import json
import requests


def main_handler(event, context):
    try:
        print("event is: ", event)

        body = json.loads(event["body"])

        url = os.environ.get("url")

        retmsg = {}
        retmsg['websocket'] = {}
        retmsg['websocket']['action'] = "data send"
        retmsg['websocket']['secConnectionID'] = body["coid"]
        retmsg['websocket']['dataType'] = 'text'
        retmsg['websocket']['data'] = body["data"]
        print(retmsg)
        requests.post(url, json=retmsg)

        return True
    except Exception as e:
        return False
