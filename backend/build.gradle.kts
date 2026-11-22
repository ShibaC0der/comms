plugins {
    kotlin("jvm") version "2.4.21"
    application
}

group = "dev.comms"
version = "0.1.0"

repositories {
    mavenCentral()
}

val ktorVersion = "3.6.1"

dependencies {
    implementation("io.ktor:ktor-server-core-jvm:$ktorVersion")
    implementation("io.ktor:ktor-server-netty-jvm:$ktorVersion")

    testImplementation(kotlin("test-junit5"))
    testRuntimeOnly("org.junit.jupiter:junit-jupiter-engine:5.13.4")
    testImplementation("io.ktor:ktor-server-test-host-jvm:$ktorVersion")
}

kotlin {
    jvmToolchain(25)
}

application {
    mainClass.set("dev.comms.ApplicationKt")
}

tasks.test {
    useJUnitPlatform()
}
