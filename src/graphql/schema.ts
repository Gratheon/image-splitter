export const schema = `
scalar JSON
scalar DateTime
scalar Upload
scalar ID

type Query {
    file(id:ID!): File
    hiveFiles(hiveId:ID!): [FrameSideFile]
		hiveFrameSideFile(frameSideId:ID!): FrameSideFile
}

type Mutation {
    uploadFrameSide(file: Upload!): File
    addFileToFrameSide(frameSideId: ID!, fileId: ID!, hiveId: ID!): Boolean
	filesStrokeEditMutation(files: [FilesUpdateInput]): Boolean
}

input FilesUpdateInput{
	hiveId: ID!
	frameSideId: ID!
	fileId: ID!
	strokeHistory: JSON!
}

type FrameSideFile {
	file: File!
	frameSideId: ID
	hiveId: ID
	strokeHistory: JSON
	detectedObjects: JSON
}

type File{
    id: ID!
    url: String
}

extend type FrameSide @key(fields: "id") {
  id: ID @external
  file: File
}

extend type Hive @key(fields: "id") {
  id: ID! @external
  files: [FrameSideFile]
}
`;
