import {
  Duration,
  IResource,
  RemovalPolicy,
  Stack,
  StackProps,
  Tags,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as cdk from 'aws-cdk-lib';

import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as efs from 'aws-cdk-lib/aws-efs';
import { Port } from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

export interface AppProps extends cdk.StackProps {
  readonly appName: string;
  readonly account: string;
}

// https://tomgregory.com/deploying-jenkins-into-aws-ecs-using-cdk/


export class AppStack extends Stack {
  constructor(scope: Construct, id: string, props?: AppProps) {
    super(scope, id, props);

    this.appName = props?.appName || '';
    const jenkinsHomeDir: string = 'jenkins-home';

    // Setup ECS Cluster
    let assetName = `${this.appName}-cluster`;
    const cluster = new ecs.Cluster(this, assetName, {
      clusterName: this.appName,
    });
    this.addAppTag(cluster);

    const vpc = cluster.vpc;
    this.addAppTag(vpc);

    // Setup EFS for cluster
    assetName = `${this.appName}-efs`;
    const fs = new efs.FileSystem(this, assetName, {
      vpc: vpc,
      fileSystemName: this.appName,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.addAppTag(fs);

    // Setup access point
    assetName = `${this.appName}-ap`;
    const accessPoint = fs.addAccessPoint(assetName, {
      path: `/${jenkinsHomeDir}`,
      posixUser: {
        uid: '1000',
        gid: '1000',
      },
      createAcl: {
        ownerGid: '1000',
        ownerUid: '1000',
        permissions: '755',
      },
    });
    this.addAppTag(accessPoint);

    // Setup task def
    assetName = `${this.appName}-task`;
    const taskDef = new ecs.FargateTaskDefinition(this, assetName, {
      family: this.appName,
      cpu: 1024,
      memoryLimitMiB: 2048,
    });
    this.addAppTag(taskDef);

    // Add volume
    taskDef.addVolume({
      name: jenkinsHomeDir,
      efsVolumeConfiguration: {
        fileSystemId: fs.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: {
          accessPointId: accessPoint.accessPointId,
          iam: 'ENABLED',
        },
      },
    });

    // Add FS Container
    const cd = taskDef.addContainer(this.appName, {
      image: ecs.ContainerImage.fromRegistry('jenkins/jenkins:lts'),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'jenkins' }),
      portMappings: [{ containerPort: 8080 }],
    });

    // Add TD Mount
    cd.addMountPoints({
      containerPath: '/var/jenkins_home',
      sourceVolume: jenkinsHomeDir,
      readOnly: false
    });

    // Setup Service
    assetName = `${this.appName}-service`;
    const fService = new ecs.FargateService(this, assetName, {
      serviceName: this.appName,
      cluster: cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      maxHealthyPercent: 100,
      minHealthyPercent: 0,
      healthCheckGracePeriod: Duration.minutes(5),
    }); // TODO : if it fails to create this it is usually because of the vpc settings
    fService.connections.allowTo(fs, Port.tcp(2049));
    this.addAppTag(fService);

    // Setup ALB
    assetName = `${this.appName}-elb`;
    const lb = new elbv2.ApplicationLoadBalancer(this, assetName, {
      loadBalancerName: this.appName,
      vpc: vpc,
      internetFacing: true,
    });
    this.addAppTag(lb);

    // ALB listener
    assetName = `${this.appName}-listener`;
    const lbListener = lb.addListener(assetName, { port: 80 }); // TODO : this should be at 443
    this.addAppTag(lbListener);

    // Add target
    assetName = `${this.appName}-target`;
    const lbTarget = lbListener.addTargets(assetName, {
      port: 8080,
      targets: [fService],
      deregistrationDelay: Duration.seconds(10),
      healthCheck: { path: '/login' },
    });
  }
  private appName: string;

  private addAppTag(resource: IResource) {
    Tags.of(resource).add('AppName', this.appName);
  }
}
