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
    implementation("io.ktor:ktor-server-websockets-jvm:$ktorVersion")
    runtimeOnly("org.slf4j:slf4j-simple:2.0.19")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")

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
