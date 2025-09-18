import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfrontOrigins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sfnTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';

export class TechNewsHubStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const staticSiteBucket = new s3.Bucket(this, 'StaticSiteBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OAI');
    staticSiteBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [staticSiteBucket.arnForObjects('*')],
        principals: [originAccessIdentity.grantPrincipal],
      }),
    );

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: new cloudfrontOrigins.S3Origin(staticSiteBucket, {
          originAccessIdentity,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    });

    const accessLogsTable = new dynamodb.Table(this, 'AccessLogsTable', {
      partitionKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'ttl',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    accessLogsTable.addGlobalSecondaryIndex({
      indexName: 'timestamp-index',
      partitionKey: { name: 'dateBucket', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
    });

    const userProfilesTable = new dynamodb.Table(this, 'UserProfilesTable', {
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const contentCacheTable = new dynamodb.Table(this, 'ContentCacheTable', {
      partitionKey: { name: 'sectionPeriod', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'expiresAt',
    });

    const webSocketSessionsTable = new dynamodb.Table(this, 'WebSocketSessionsTable', {
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    const apiSecrets = new secretsmanager.Secret(this, 'ApiSecrets', {
      description: 'API keys for AI providers and weather integrations',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          perplexityApiKey: '',
          geminiApiKey: '',
          chatGptApiKey: '',
          openWeatherApiKey: '',
          newsApiKey: '',
          xBearerToken: '',
          googleClientId: '',
          googleClientSecret: '',
        }),
        generateStringKey: 'placeholder',
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const userPool = new cognito.UserPool(this, 'UserPool', {
      signInAliases: { email: true },
      selfSignUpEnabled: false,
      standardAttributes: {
        email: { required: true, mutable: false },
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool,
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
          cognito.OAuthScope.OPENID,
        ],
        callbackUrls: ['https://example.com/auth/callback'],
        logoutUrls: ['https://example.com/logout'],
      },
      preventUserExistenceErrors: true,
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.GOOGLE,
      ],
    });

    new cognito.UserPoolIdentityProviderGoogle(this, 'GoogleProvider', {
      userPool,
      clientId: apiSecrets.secretValueFromJson('googleClientId').unsafeUnwrap(),
      clientSecret: apiSecrets.secretValueFromJson('googleClientSecret').unsafeUnwrap(),
      scopes: ['profile', 'email', 'openid'],
      attributeMapping: {
        email: cognito.ProviderAttribute.GOOGLE_EMAIL,
        fullname: cognito.ProviderAttribute.GOOGLE_NAMES,
      },
    });

    const commonLambdaProps: Partial<lambdaNodejs.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      memorySize: 1024,
      bundling: {
        target: 'es2020',
        format: lambdaNodejs.OutputFormat.CJS,
        minify: true,
        externalModules: ['aws-sdk'],
      },
      depsLockFilePath: path.join(__dirname, '../package-lock.json'),
      environment: {
        ACCESS_LOGS_TABLE_NAME: accessLogsTable.tableName,
        USER_PROFILES_TABLE_NAME: userProfilesTable.tableName,
        CONTENT_CACHE_TABLE_NAME: contentCacheTable.tableName,
        API_SECRET_ARN: apiSecrets.secretArn,
        DISTRIBUTION_DOMAIN: distribution.domainName,
        WEBSOCKET_SESSIONS_TABLE_NAME: webSocketSessionsTable.tableName,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    };

    const fetchNewsFunction = new lambdaNodejs.NodejsFunction(this, 'FetchNewsFunction', {
      entry: path.join(__dirname, '../lambda/fetchNews.ts'),
      handler: 'handler',
      ...commonLambdaProps,
    });

    const fetchPatentsFunction = new lambdaNodejs.NodejsFunction(this, 'FetchPatentsFunction', {
      entry: path.join(__dirname, '../lambda/fetchPatents.ts'),
      handler: 'handler',
      ...commonLambdaProps,
    });

    const geoEnrichFunction = new lambdaNodejs.NodejsFunction(this, 'GeoEnrichFunction', {
      entry: path.join(__dirname, '../lambda/geoEnrich.ts'),
      handler: 'handler',
      ...commonLambdaProps,
    });

    const authCallbackFunction = new lambdaNodejs.NodejsFunction(this, 'AuthCallbackFunction', {
      entry: path.join(__dirname, '../lambda/authCallback.ts'),
      handler: 'handler',
      ...commonLambdaProps,
    });

    const dailyRefreshFunction = new lambdaNodejs.NodejsFunction(this, 'DailyRefreshFunction', {
      entry: path.join(__dirname, '../lambda/dailyRefresh.ts'),
      handler: 'handler',
      timeout: Duration.minutes(5),
      memorySize: 1024,
      ...commonLambdaProps,
    });

    const profileMeFunction = new lambdaNodejs.NodejsFunction(this, 'ProfileMeFunction', {
      entry: path.join(__dirname, '../lambda/profileMe.ts'),
      handler: 'handler',
      ...commonLambdaProps,
    });

    const searchFunction = new lambdaNodejs.NodejsFunction(this, 'SearchFunction', {
      entry: path.join(__dirname, '../lambda/searchHandler.ts'),
      handler: 'handler',
      timeout: Duration.seconds(45),
      memorySize: 1536,
      ...commonLambdaProps,
    });

    const recommendationsFunction = new lambdaNodejs.NodejsFunction(this, 'RecommendationsFunction', {
      entry: path.join(__dirname, '../lambda/recommendations.ts'),
      handler: 'handler',
      ...commonLambdaProps,
    });

    const relatedContentFunction = new lambdaNodejs.NodejsFunction(this, 'RelatedContentFunction', {
      entry: path.join(__dirname, '../lambda/relatedContent.ts'),
      handler: 'handler',
      timeout: Duration.seconds(45),
      memorySize: 1536,
      ...commonLambdaProps,
    });

    const websocketManagerFunction = new lambdaNodejs.NodejsFunction(this, 'WebsocketManagerFunction', {
      entry: path.join(__dirname, '../lambda/websocketManager.ts'),
      handler: 'handler',
      ...commonLambdaProps,
    });

    accessLogsTable.grantReadWriteData(geoEnrichFunction);
    userProfilesTable.grantReadWriteData(authCallbackFunction);
    userProfilesTable.grantReadData(fetchNewsFunction);
    userProfilesTable.grantReadData(fetchPatentsFunction);
    contentCacheTable.grantReadWriteData(fetchNewsFunction);
    contentCacheTable.grantReadWriteData(fetchPatentsFunction);
    contentCacheTable.grantReadWriteData(dailyRefreshFunction);
    contentCacheTable.grantReadData(relatedContentFunction);

    apiSecrets.grantRead(fetchNewsFunction);
    apiSecrets.grantRead(fetchPatentsFunction);
    apiSecrets.grantRead(geoEnrichFunction);
    apiSecrets.grantRead(authCallbackFunction);
    apiSecrets.grantRead(dailyRefreshFunction);
    apiSecrets.grantRead(searchFunction);
    apiSecrets.grantRead(relatedContentFunction);

    accessLogsTable.grantReadData(recommendationsFunction);
    userProfilesTable.grantReadData(profileMeFunction);
    webSocketSessionsTable.grantReadWriteData(websocketManagerFunction);
    webSocketSessionsTable.grantReadData(dailyRefreshFunction);

    const restApi = new apigw.RestApi(this, 'TechNewsHubApi', {
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: apigw.Cors.DEFAULT_HEADERS,
      },
      deployOptions: {
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        tracingEnabled: true,
        metricsEnabled: true,
      },
      cloudWatchRole: true,
    });

    const newsResource = restApi.root.addResource('news');
    newsResource.addMethod('POST', new apigw.LambdaIntegration(fetchNewsFunction));

    const patentsResource = restApi.root.addResource('patents');
    patentsResource.addMethod('POST', new apigw.LambdaIntegration(fetchPatentsFunction));

    const geoResource = restApi.root.addResource('geo-enrich');
    geoResource.addMethod('POST', new apigw.LambdaIntegration(geoEnrichFunction));

    const authResource = restApi.root.addResource('auth');
    authResource.addMethod('POST', new apigw.LambdaIntegration(authCallbackFunction));

    const profileResource = restApi.root.addResource('profile');
    const profileMeResource = profileResource.addResource('me');
    profileMeResource.addMethod('GET', new apigw.LambdaIntegration(profileMeFunction));

    const searchResource = restApi.root.addResource('search');
    searchResource.addMethod('POST', new apigw.LambdaIntegration(searchFunction));

    const recommendationsResource = restApi.root.addResource('recommendations');
    recommendationsResource.addMethod('POST', new apigw.LambdaIntegration(recommendationsFunction));

    const contentResource = restApi.root.addResource('content');
    const sectionResource = contentResource.addResource('{section}');
    const periodResource = sectionResource.addResource('{period}');
    const contentItemResource = periodResource.addResource('{itemId}');
    contentItemResource.addMethod('GET', new apigw.LambdaIntegration(relatedContentFunction));

    const websocketApi = new apigwv2.WebSocketApi(this, 'TechNewsHubWebsocketApi', {
      connectRouteOptions: {
        integration: new apigwv2Integrations.WebSocketLambdaIntegration(
          'ConnectIntegration',
          websocketManagerFunction,
        ),
      },
      defaultRouteOptions: {
        integration: new apigwv2Integrations.WebSocketLambdaIntegration(
          'DefaultIntegration',
          websocketManagerFunction,
        ),
      },
      disconnectRouteOptions: {
        integration: new apigwv2Integrations.WebSocketLambdaIntegration(
          'DisconnectIntegration',
          websocketManagerFunction,
        ),
      },
    });

    const websocketStage = new apigwv2.WebSocketStage(this, 'TechNewsHubWebsocketStage', {
      webSocketApi: websocketApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    websocketStage.grantManagementApiAccess(dailyRefreshFunction);

    const sections = ['ml', 'ai', 'iot', 'quantum'];
    const timePeriods = ['daily', 'weekly', 'monthly', 'yearly'];

    const prepareInput = new sfn.Pass(this, 'PrepareRefreshInput', {
      result: sfn.Result.fromObject({ sections, timePeriods }),
      resultPath: '$.config',
    });

    const timePeriodIterator = new sfn.Map(this, 'ForEachTimePeriod', {
      itemsPath: '$.timePeriods',
      parameters: {
        'section.$': '$.section',
        'timePeriod.$': '$$.Map.Item.Value',
      },
    });

    const fetchNewsTask = new sfnTasks.LambdaInvoke(this, 'InvokeFetchNews', {
      lambdaFunction: fetchNewsFunction,
      payload: sfn.TaskInput.fromObject({
        section: sfn.JsonPath.stringAt('$.section'),
        timePeriod: sfn.JsonPath.stringAt('$.timePeriod'),
        mode: 'refresh',
      }),
      payloadResponseOnly: true,
    });

    const fetchPatentsTask = new sfnTasks.LambdaInvoke(this, 'InvokeFetchPatents', {
      lambdaFunction: fetchPatentsFunction,
      payload: sfn.TaskInput.fromObject({
        section: sfn.JsonPath.stringAt('$.section'),
        timePeriod: sfn.JsonPath.stringAt('$.timePeriod'),
        mode: 'refresh',
      }),
      payloadResponseOnly: true,
    });

    fetchNewsTask.next(fetchPatentsTask);
    timePeriodIterator.iterator(fetchNewsTask);

    const sectionIterator = new sfn.Map(this, 'ForEachSection', {
      itemsPath: '$.config.sections',
      parameters: {
        'section.$': '$$.Map.Item.Value',
        'timePeriods.$': '$.config.timePeriods',
      },
    });

    const prepareSectionContext = new sfn.Pass(this, 'PrepareSectionContext', {
      parameters: {
        'section.$': '$.section',
        'timePeriods.$': '$.timePeriods',
      },
    });

    prepareSectionContext.next(timePeriodIterator);
    sectionIterator.iterator(prepareSectionContext);

    const refreshStateMachine = new sfn.StateMachine(this, 'RefreshStateMachine', {
      definition: prepareInput.next(sectionIterator),
      timeout: Duration.minutes(15),
      tracingEnabled: true,
    });

    refreshStateMachine.grantStartExecution(dailyRefreshFunction);

    const refreshRule = new events.Rule(this, 'DailyRefreshRule', {
      schedule: events.Schedule.cron({ minute: '0', hour: '0' }),
      description: 'Trigger the TechNewsHub refresh workflow at midnight UTC',
    });
    refreshRule.addTarget(new eventsTargets.LambdaFunction(dailyRefreshFunction));

    const managementEndpoint = `https://${websocketApi.apiId}.execute-api.${Stack.of(this).region}.amazonaws.com/${websocketStage.stageName}`;
    dailyRefreshFunction.addEnvironment('STATE_MACHINE_ARN', refreshStateMachine.stateMachineArn);
    dailyRefreshFunction.addEnvironment('WEBSOCKET_ENDPOINT', managementEndpoint);

    const errorAlarm = new cloudwatch.Alarm(this, 'ApiGatewayErrorAlarm', {
      metric: restApi.metricServerError({ period: Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      treatMissingData: cloudwatch.TreatMissingData.IGNORE,
      alarmDescription: 'Alarm if API Gateway returns server errors',
    });

    const lambdaErrorMetric = fetchNewsFunction.metricErrors({ period: Duration.minutes(5) });
    new cloudwatch.Alarm(this, 'FetchNewsErrorAlarm', {
      metric: lambdaErrorMetric,
      threshold: 1,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Alarm when fetchNews fails',
    });

    new cloudwatch.Dashboard(this, 'OperationsDashboard', {
      dashboardName: 'TechNewsHubOps',
      widgets: [
        [
          new cloudwatch.GraphWidget({
            title: 'API Gateway 5xx Errors',
            left: [restApi.metricServerError()],
          }),
          new cloudwatch.GraphWidget({
            title: 'Lambda Invocations',
            left: [fetchNewsFunction.metricInvocations(), fetchPatentsFunction.metricInvocations()],
          }),
        ],
        [
          new cloudwatch.GraphWidget({
            title: 'DynamoDB Throttles',
            left: [
              accessLogsTable.metricThrottledRequests(),
              contentCacheTable.metricThrottledRequests(),
            ],
          }),
          new cloudwatch.GraphWidget({
            title: 'CloudFront Requests',
            left: [distribution.metricRequests()],
          }),
        ],
      ],
    });

    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: distribution.domainName,
    });
    new cdk.CfnOutput(this, 'RestApiUrl', {
      value: restApi.url,
    });
    new cdk.CfnOutput(this, 'WebsocketEndpoint', {
      value: websocketApi.apiEndpoint,
    });
  }
}
